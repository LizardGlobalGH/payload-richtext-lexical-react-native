#!/usr/bin/env node

/**
 * Build a dependency graph from entry files/folders, then optionally
 * sync / compare / scan against an upstream package path.
 *
 * Usage:
 *   node scripts/upstream-deps.mjs <files-or-folders...> [--debug]
 *   node scripts/upstream-deps.mjs <files-or-folders...> --sync <upstream>
 *   node scripts/upstream-deps.mjs <files-or-folders...> --compare <upstream>
 *   node scripts/upstream-deps.mjs <files-or-folders...> --scan <upstream>
 *   node scripts/upstream-deps.mjs <files-or-folders...> --graph
 *   node scripts/upstream-deps.mjs <files-or-folders...> --sync <upstream> --exclude src/foo --config ./upstream-deps.config.json
 *
 * Config file (JSON object):
 *   {
 *     "exclude": ["src/exports/react-native", "src/features/converters/lexicalToReactNative"]
 *   }
 */

import { Command } from 'commander'
import { createHash } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { styleText } from 'node:util'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
])

const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.css',
  '.scss',
]

const INDEX_CANDIDATES = RESOLVE_EXTENSIONS.filter(Boolean).flatMap((ext) => [
  `index${ext}`,
])

/** Match static import/export-from, dynamic import(), and require(). */
const IMPORT_PATTERN =
  /(?:import|export)(?:\s+type)?(?:[\s\S]*?\s+from\s*|\s+)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const ALWAYS_SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'esbuild', 'coverage'])

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }

function createLogger(debugEnabled) {
  const maxLevel = debugEnabled ? LEVELS.debug : LEVELS.info
  const useColor = Boolean(process.stdout.isTTY)

  const paint = (color, text) => (useColor ? styleText(color, text) : text)

  const write = (level, label, color, args) => {
    if (LEVELS[level] > maxLevel) return
    const prefix = paint(color, `[${label}]`)
    const stream = level === 'error' ? process.stderr : process.stdout
    stream.write(`${prefix} ${args.map(String).join(' ')}\n`)
  }

  return {
    error: (...args) => write('error', 'error', 'red', args),
    warn: (...args) => write('warn', 'warn', 'yellow', args),
    info: (...args) => write('info', 'info', 'cyan', args),
    debug: (...args) => write('debug', 'debug', 'gray', args),
    success: (...args) => write('info', 'ok', 'green', args),
  }
}

/** @type {ReturnType<typeof createLogger>} */
let log = createLogger(false)

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(path) {
  return path.split(sep).join('/')
}

function isDotDirName(name) {
  return name.startsWith('.')
}

/**
 * Recursively collect file paths under `root`.
 * Skips dot-directories (e.g. `.git`) but keeps dot-files (e.g. `.swcrc`).
 */
async function collectFiles(root, { skipDirNames = ALWAYS_SKIP_DIR_NAMES } = {}) {
  const files = []

  async function walk(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      log.debug(`Unable to read directory ${dir}: ${error.message}`)
      return
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (isDotDirName(entry.name) || skipDirNames.has(entry.name)) {
          log.debug(`Skipping directory ${abs}`)
          continue
        }
        await walk(abs)
        continue
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(abs)
      }
    }
  }

  const rootStat = await stat(root)
  if (rootStat.isFile()) {
    return [root]
  }

  await walk(root)
  return files
}

/**
 * Expand user-provided paths (files and folders) into absolute file paths.
 */
async function expandEntries(paths, cwd = PROJECT_ROOT) {
  const collected = new Set()

  for (const raw of paths) {
    const abs = isAbsolute(raw) ? raw : resolve(cwd, raw)
    try {
      await stat(abs)
    } catch {
      throw new Error(`Path does not exist: ${raw} (${abs})`)
    }

    const files = await collectFiles(abs)
    for (const file of files) {
      collected.add(file)
    }
  }

  return [...collected].sort()
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function hashFile(path) {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

async function ensureParentDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true })
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

function extractImportSpecifiers(source) {
  const specifiers = new Set()
  IMPORT_PATTERN.lastIndex = 0

  let match
  while ((match = IMPORT_PATTERN.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) specifiers.add(specifier)
  }

  return [...specifiers]
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

/**
 * Resolve a relative import to an on-disk file.
 * Handles TS/JS extension remapping (`.js` → `.ts` / `.tsx`, etc.).
 */
async function resolveSpecifier(fromFile, specifier) {
  if (!isRelativeSpecifier(specifier)) {
    return null
  }

  const base = resolve(dirname(fromFile), specifier)
  const candidates = []

  // As written
  candidates.push(base)

  // Extension swap: import './foo.js' → foo.ts / foo.tsx / …
  const ext = extname(base)
  if (ext) {
    const withoutExt = base.slice(0, -ext.length)
    for (const next of RESOLVE_EXTENSIONS) {
      if (next && next !== ext) candidates.push(withoutExt + next)
    }
    // Also try directory index if the path without extension is a folder
    for (const indexName of INDEX_CANDIDATES) {
      candidates.push(join(withoutExt, indexName))
    }
  } else {
    for (const next of RESOLVE_EXTENSIONS) {
      if (next) candidates.push(base + next)
    }
    for (const indexName of INDEX_CANDIDATES) {
      candidates.push(join(base, indexName))
    }
  }

  // Deduplicate while preserving order
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      const s = await lstat(candidate)
      if (s.isFile()) return candidate
    } catch {
      // continue
    }
  }

  return null
}

/**
 * Build a directed dependency graph for the given entry files.
 * Only follows relative imports; package imports are ignored.
 *
 * @returns {{
 *   graph: Map<string, Set<string>>,
 *   allFiles: string[],
 *   unresolved: Array<{ from: string, specifier: string }>,
 * }}
 */
async function buildDependencyGraph(entryFiles) {
  const graph = new Map()
  const unresolved = []
  const queue = [...entryFiles]
  const visited = new Set()

  while (queue.length > 0) {
    const file = queue.pop()
    if (visited.has(file)) continue
    visited.add(file)

    if (!graph.has(file)) graph.set(file, new Set())

    const ext = extname(file).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext)) {
      log.debug(`Skipping non-code file for import scan: ${file}`)
      continue
    }

    let source
    try {
      source = await readFile(file, 'utf8')
    } catch (error) {
      log.warn(`Could not read ${file}: ${error.message}`)
      continue
    }

    const specifiers = extractImportSpecifiers(source)
    log.debug(`${relative(PROJECT_ROOT, file) || file}: ${specifiers.length} import(s)`)

    for (const specifier of specifiers) {
      if (!isRelativeSpecifier(specifier)) {
        log.debug(`  external: ${specifier}`)
        continue
      }

      const resolved = await resolveSpecifier(file, specifier)
      if (!resolved) {
        unresolved.push({ from: file, specifier })
        log.debug(`  unresolved: ${specifier}`)
        continue
      }

      graph.get(file).add(resolved)
      log.debug(`  → ${relative(PROJECT_ROOT, resolved) || resolved}`)

      if (!visited.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  const allFiles = [...visited].sort()
  return { graph, allFiles, unresolved }
}

function relLabel(file) {
  return toPosix(relative(PROJECT_ROOT, file) || file)
}

/**
 * Print dependency chains as trees rooted at each entry point.
 * Shared nodes already expanded elsewhere are marked instead of re-printed in full.
 * Cycles along the current path are marked to avoid infinite recursion.
 */
function printDependencyGraph(entryFiles, graph) {
  log.info('Dependency chains from entry points:')

  const fullyExpanded = new Set()

  function walk(file, prefix, isLast, pathStack) {
    const label = relLabel(file)
    const branch = prefix ? (isLast ? '└─ ' : '├─ ') : ''
    const childPrefix = prefix ? prefix + (isLast ? '   ' : '│  ') : '  '

    if (pathStack.has(file)) {
      log.info(`${prefix}${branch}${label}  (circular)`)
      return
    }

    const deps = [...(graph.get(file) ?? [])].sort((a, b) =>
      relLabel(a).localeCompare(relLabel(b)),
    )

    if (fullyExpanded.has(file) && pathStack.size > 0) {
      log.info(`${prefix}${branch}${label}  (already shown)`)
      return
    }

    fullyExpanded.add(file)

    if (deps.length === 0) {
      log.info(`${prefix}${branch}${label}`)
      return
    }

    log.info(`${prefix}${branch}${label}`)

    const nextStack = new Set(pathStack)
    nextStack.add(file)

    deps.forEach((dep, index) => {
      walk(dep, childPrefix, index === deps.length - 1, nextStack)
    })
  }

  const sortedEntries = [...entryFiles].sort((a, b) => relLabel(a).localeCompare(relLabel(b)))

  for (const entry of sortedEntries) {
    walk(entry, '', true, new Set())
  }
}

function printDependencyReport(entryFiles, graph, allFiles, unresolved, { showGraph = false } = {}) {
  const entrySet = new Set(entryFiles)
  const dependencies = allFiles.filter((f) => !entrySet.has(f))

  log.info(`Entries: ${entryFiles.length}`)
  log.info(`Transitive local dependencies: ${dependencies.length}`)
  log.info(`Total files in graph: ${allFiles.length}`)

  if (unresolved.length > 0) {
    log.warn(`Unresolved relative imports: ${unresolved.length}`)
    for (const item of unresolved) {
      log.warn(`  ${relLabel(item.from)} → ${item.specifier}`)
    }
  }

  log.info('All files (entries + dependencies):')
  for (const file of allFiles) {
    const tag = entrySet.has(file) ? 'entry' : 'dep'
    log.info(`  [${tag}] ${relLabel(file)}`)
  }

  if (showGraph) {
    printDependencyGraph(entryFiles, graph)
  } else {
    log.debug('Dependency chains (pass --graph to print):')
    // Keep a compact adjacency dump for debug when --graph is off
    const sortedNodes = [...graph.keys()].sort((a, b) => relLabel(a).localeCompare(relLabel(b)))
    for (const node of sortedNodes) {
      const deps = [...graph.get(node)].sort((a, b) => relLabel(a).localeCompare(relLabel(b)))
      log.debug(`  ${relLabel(node)}`)
      for (const dep of deps) {
        log.debug(`    → ${relLabel(dep)}`)
      }
    }
  }

  return { dependencies, allFiles }
}

// ---------------------------------------------------------------------------
// Exclusion list / config
// ---------------------------------------------------------------------------

function collectOption(value, previous) {
  return previous.concat([value])
}

/**
 * Normalize a user-provided path to a project-relative posix path.
 */
function normalizeExcludePattern(raw) {
  let value = String(raw).trim()
  if (!value) return null

  // Strip trailing slashes except for root-style empties
  value = value.replace(/\\/g, '/').replace(/\/+$/, '')

  if (isAbsolute(value)) {
    value = toPosix(relative(PROJECT_ROOT, value))
  }

  // Allow patterns that start with ./
  if (value.startsWith('./')) {
    value = value.slice(2)
  }

  if (!value || value.startsWith('..')) {
    throw new Error(`Exclude path must be inside the project: ${raw}`)
  }

  return value
}

/**
 * Build a matcher for exclude patterns (files or folders).
 * A folder pattern matches the folder itself and every path under it.
 */
function createExclusionMatcher(patterns) {
  const normalized = []
  for (const pattern of patterns) {
    const next = normalizeExcludePattern(pattern)
    if (next) normalized.push(next)
  }

  // Deduplicate
  const unique = [...new Set(normalized)].sort()

  const isExcluded = (relPath) => {
    const rel = toPosix(relPath).replace(/^\.\//, '')
    for (const pattern of unique) {
      if (rel === pattern || rel.startsWith(`${pattern}/`)) {
        return true
      }
    }
    return false
  }

  return { patterns: unique, isExcluded }
}

/**
 * Load a JSON config file. Must be a plain object with keys.
 * Supported keys:
 *   - exclude: string[] — files/folders skipped during sync/compare
 */
async function loadConfigFile(configPath) {
  const abs = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath)

  if (!(await fileExists(abs))) {
    throw new Error(`Config file does not exist: ${configPath}`)
  }

  let parsed
  try {
    const raw = await readFile(abs, 'utf8')
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to read config file ${configPath}: ${error.message}`)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file must contain a JSON object with keys: ${configPath}`)
  }

  const knownKeys = new Set(['exclude'])
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) {
      log.warn(`Unknown config key "${key}" in ${configPath} (ignored)`)
    }
  }

  const exclude = parsed.exclude ?? []
  if (!Array.isArray(exclude) || exclude.some((item) => typeof item !== 'string')) {
    throw new Error(`Config key "exclude" must be an array of strings: ${configPath}`)
  }

  log.info(`Loaded config from ${abs}`)
  log.debug(`Config keys: ${Object.keys(parsed).join(', ') || '(none)'}`)

  return { exclude }
}

/**
 * Merge CLI --exclude paths with config.exclude.
 */
async function resolveExclusions({ excludeFromCli = [], configPath }) {
  /** @type {string[]} */
  const fromConfig = []

  if (configPath) {
    const config = await loadConfigFile(configPath)
    fromConfig.push(...config.exclude)
  }

  const merged = [...fromConfig, ...excludeFromCli]
  const matcher = createExclusionMatcher(merged)

  if (matcher.patterns.length > 0) {
    log.info(`Exclusion list (${matcher.patterns.length}):`)
    for (const pattern of matcher.patterns) {
      log.info(`  - ${pattern}`)
    }
  } else {
    log.debug('No exclusion patterns configured')
  }

  return matcher
}

/**
 * Split a sync/compare diff into actionable vs excluded buckets.
 */
function partitionDiffByExclusion(diff, isExcluded) {
  const split = (list) => {
    const actionable = []
    const excluded = []
    for (const rel of list) {
      if (isExcluded(rel)) excluded.push(rel)
      else actionable.push(rel)
    }
    return { actionable, excluded }
  }

  const added = split(diff.added)
  const modified = split(diff.modified)
  const removed = split(diff.removed)
  // Unchanged excluded files don't need warnings; keep them out of actionable noise
  const unchanged = diff.unchanged.filter((rel) => !isExcluded(rel))

  return {
    actionable: {
      added: added.actionable,
      modified: modified.actionable,
      removed: removed.actionable,
      unchanged,
    },
    excluded: {
      added: added.excluded,
      modified: modified.excluded,
      removed: removed.excluded,
      unchanged: diff.unchanged.filter((rel) => isExcluded(rel)),
    },
  }
}

// ---------------------------------------------------------------------------
// Sync / compare
// ---------------------------------------------------------------------------

/**
 * Validate upstream package path and return absolute path.
 */
async function resolveUpstream(upstreamPath) {
  const abs = isAbsolute(upstreamPath) ? upstreamPath : resolve(process.cwd(), upstreamPath)

  if (!(await fileExists(abs))) {
    throw new Error(`Upstream path does not exist: ${upstreamPath}`)
  }

  const srcDir = join(abs, 'src')
  if (!(await fileExists(srcDir))) {
    throw new Error(`Upstream path must contain an "src" folder: ${abs}`)
  }

  const srcStat = await stat(srcDir)
  if (!srcStat.isDirectory()) {
    throw new Error(`Upstream "src" exists but is not a directory: ${srcDir}`)
  }

  return abs
}

/**
 * Collect a relative-path → absolute-path map for a package root.
 * Dot-directories are skipped; dot-files are kept.
 */
async function collectRelativeTree(root) {
  const files = await collectFiles(root)
  /** @type {Map<string, string>} */
  const map = new Map()

  for (const abs of files) {
    const rel = toPosix(relative(root, abs))
    if (!rel || rel.startsWith('..')) continue
    map.set(rel, abs)
  }

  return map
}

/**
 * Dest paths managed by sync are those under top-level entries present in source.
 * This avoids deleting unrelated top-level project files (e.g. custom scripts).
 */
async function collectManagedDestTree(projectRoot, sourceTree) {
  const topLevels = new Set()
  for (const rel of sourceTree.keys()) {
    topLevels.add(rel.split('/')[0])
  }

  /** @type {Map<string, string>} */
  const map = new Map()

  for (const top of topLevels) {
    const absTop = join(projectRoot, top)
    if (!(await fileExists(absTop))) continue

    const files = await collectFiles(absTop)
    for (const abs of files) {
      const rel = toPosix(relative(projectRoot, abs))
      map.set(rel, abs)
    }
  }

  return map
}

/**
 * Diff source (upstream) vs destination (project) trees.
 */
async function diffTrees(sourceTree, destTree) {
  const added = []
  const removed = []
  const modified = []
  const unchanged = []

  for (const [rel, sourceAbs] of sourceTree) {
    const destAbs = destTree.get(rel)
    if (!destAbs) {
      added.push(rel)
      continue
    }

    const [sourceHash, destHash] = await Promise.all([hashFile(sourceAbs), hashFile(destAbs)])
    if (sourceHash === destHash) {
      unchanged.push(rel)
    } else {
      modified.push(rel)
    }
  }

  for (const rel of destTree.keys()) {
    if (!sourceTree.has(rel)) {
      removed.push(rel)
    }
  }

  added.sort()
  removed.sort()
  modified.sort()
  unchanged.sort()

  return { added, removed, modified, unchanged }
}

function printTreeDiff(diff, { dryRun, excludedDiff }) {
  const verb = dryRun ? 'Would' : 'Will'
  log.info(`${dryRun ? 'Compare' : 'Sync'} summary:`)
  log.info(`  added:     ${diff.added.length}`)
  log.info(`  modified:  ${diff.modified.length}`)
  log.info(`  removed:   ${diff.removed.length}`)
  log.info(`  unchanged: ${diff.unchanged.length}`)
  if (excludedDiff) {
    const skipped =
      excludedDiff.added.length + excludedDiff.modified.length + excludedDiff.removed.length
    log.info(`  excluded (skipped): ${skipped}`)
  }

  for (const rel of diff.added) {
    log.info(`  + ${rel}  (${verb.toLowerCase()} copy)`)
  }
  for (const rel of diff.modified) {
    log.info(`  ~ ${rel}  (${verb.toLowerCase()} overwrite)`)
  }
  for (const rel of diff.removed) {
    log.info(`  - ${rel}  (${verb.toLowerCase()} remove)`)
  }
}

/**
 * Warn when excluded paths differ from upstream (would have been edited by sync).
 */
function warnExcludedEdits(excludedDiff, { dryRun }) {
  const edited = [
    ...excludedDiff.added.map((rel) => ({ rel, kind: 'added' })),
    ...excludedDiff.modified.map((rel) => ({ rel, kind: 'modified' })),
    ...excludedDiff.removed.map((rel) => ({ rel, kind: 'removed' })),
  ]

  if (edited.length === 0) {
    log.debug('No excluded files differ from upstream')
    return
  }

  const action = dryRun ? 'differ from upstream' : 'differ from upstream and were left untouched'
  log.warn(`Excluded files ${action} (${edited.length}):`)
  for (const { rel, kind } of edited) {
    const marker = kind === 'added' ? '+' : kind === 'removed' ? '-' : '~'
    log.warn(`  ${marker} ${rel}  (excluded, ${kind})`)
  }
}

async function applySync(sourceTree, projectRoot, diff) {
  for (const rel of [...diff.added, ...diff.modified]) {
    const sourceAbs = sourceTree.get(rel)
    const destAbs = join(projectRoot, rel)
    await ensureParentDir(destAbs)
    await copyFile(sourceAbs, destAbs)
    log.debug(`Copied ${rel}`)
  }

  for (const rel of diff.removed) {
    const destAbs = join(projectRoot, rel)
    await rm(destAbs, { force: true })
    log.debug(`Removed ${rel}`)
  }

  // Clean empty directories left behind by removals (best-effort, deepest first)
  const dirs = [
    ...new Set(diff.removed.map((rel) => toPosix(dirname(rel))).filter((d) => d && d !== '.')),
  ].sort((a, b) => b.split('/').length - a.split('/').length)

  for (const dir of dirs) {
    const abs = join(projectRoot, dir)
    try {
      const entries = await readdir(abs)
      if (entries.length === 0) {
        await rm(abs, { recursive: true, force: true })
        log.debug(`Removed empty directory ${dir}`)
      }
    } catch {
      // already gone
    }
  }
}

async function runSyncOrCompare(upstreamPath, { dryRun, isExcluded }) {
  const upstream = await resolveUpstream(upstreamPath)
  log.info(`${dryRun ? 'Comparing' : 'Syncing'} from ${upstream}`)
  log.info(`Target project: ${PROJECT_ROOT}`)

  const sourceTree = await collectRelativeTree(upstream)
  const destTree = await collectManagedDestTree(PROJECT_ROOT, sourceTree)

  log.debug(`Upstream files: ${sourceTree.size}`)
  log.debug(`Managed project files: ${destTree.size}`)

  const fullDiff = await diffTrees(sourceTree, destTree)
  const { actionable, excluded } = partitionDiffByExclusion(fullDiff, isExcluded)

  printTreeDiff(actionable, { dryRun, excludedDiff: excluded })
  warnExcludedEdits(excluded, { dryRun })

  if (dryRun) {
    log.success('Compare complete (no files were changed)')
    return { actionable, excluded }
  }

  await applySync(sourceTree, PROJECT_ROOT, actionable)
  log.success(
    `Sync complete (${actionable.added.length} added, ${actionable.modified.length} updated, ${actionable.removed.length} removed, ${excluded.added.length + excluded.modified.length + excluded.removed.length} excluded skipped)`,
  )
  return { actionable, excluded }
}

// ---------------------------------------------------------------------------
// Scan (entry + dependency change detection vs upstream)
// ---------------------------------------------------------------------------

async function runScan(upstreamPath, allFiles) {
  const upstream = await resolveUpstream(upstreamPath)
  log.info(`Scanning for changes against ${upstream}`)

  const changed = []
  const missingUpstream = []
  const missingLocal = []
  const unchanged = []

  for (const localAbs of allFiles) {
    const rel = toPosix(relative(PROJECT_ROOT, localAbs))
    const upstreamAbs = join(upstream, rel)

    const localOk = await fileExists(localAbs)
    const upstreamOk = await fileExists(upstreamAbs)

    if (!localOk) {
      missingLocal.push(rel)
      log.debug(`missing locally: ${rel}`)
      continue
    }

    if (!upstreamOk) {
      missingUpstream.push(rel)
      log.debug(`missing upstream (local-only): ${rel}`)
      continue
    }

    const [localHash, upstreamHash] = await Promise.all([
      hashFile(localAbs),
      hashFile(upstreamAbs),
    ])

    if (localHash === upstreamHash) {
      unchanged.push(rel)
      log.debug(`unchanged: ${rel}`)
    } else {
      changed.push(rel)
      log.debug(`changed: ${rel}`)
    }
  }

  log.info('Scan results:')
  log.info(`  changed:          ${changed.length}`)
  log.info(`  unchanged:        ${unchanged.length}`)
  log.info(`  missing upstream: ${missingUpstream.length} (local-only / fork files)`)
  log.info(`  missing local:    ${missingLocal.length}`)

  for (const rel of changed) {
    log.info(`  ~ ${rel}`)
  }
  for (const rel of missingUpstream) {
    log.info(`  ? ${rel}  (not in upstream)`)
  }
  for (const rel of missingLocal) {
    log.warn(`  ! ${rel}  (missing locally)`)
  }

  const hasChanges = changed.length > 0 || missingLocal.length > 0
  if (hasChanges) {
    log.warn('One or more entry files or dependencies differ from upstream')
  } else {
    log.success('All tracked files match upstream (local-only files ignored)')
  }

  return { changed, unchanged, missingUpstream, missingLocal, hasChanges }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command()

program
  .name('upstream-deps')
  .description(
    'Build a local dependency graph from entry files/folders, and optionally sync, compare, or scan against an upstream package',
  )
  .argument('<paths...>', 'entry files and/or folders to analyze (folders are scanned recursively)')
  .option('--sync <path>', 'mirror upstream package into this project (requires upstream/src)')
  .option('--compare <path>', 'dry-run of --sync; report adds/updates/removes without changing files')
  .option(
    '--scan <path>',
    'check whether entry files or any of their local dependencies differ from upstream',
  )
  .option('--graph', 'print the full dependency graph (file → local imports)', false)
  .option(
    '--exclude <path>',
    'file or folder to skip during sync/compare (repeatable; merges with config)',
    collectOption,
    [],
  )
  .option(
    '-c, --config <path>',
    'JSON config file path (object with keys; supports "exclude": string[])',
  )
  .option('--debug', 'enable debug logging', false)
  .action(async (paths, options) => {
    log = createLogger(Boolean(options.debug))

    const modes = [options.sync, options.compare, options.scan].filter(Boolean)
    if (modes.length > 1) {
      throw new Error('Use only one of --sync, --compare, or --scan')
    }

    log.info(`Project root: ${PROJECT_ROOT}`)
    log.debug(`Entry paths: ${paths.join(', ')}`)

    const { isExcluded } = await resolveExclusions({
      excludeFromCli: options.exclude ?? [],
      configPath: options.config,
    })

    const entryFiles = await expandEntries(paths, process.cwd())
    if (entryFiles.length === 0) {
      throw new Error('No files found from the provided paths')
    }

    log.info(`Collected ${entryFiles.length} entry file(s)`)
    for (const file of entryFiles) {
      log.debug(`  entry: ${toPosix(relative(PROJECT_ROOT, file) || file)}`)
    }

    const { graph, allFiles, unresolved } = await buildDependencyGraph(entryFiles)
    printDependencyReport(entryFiles, graph, allFiles, unresolved, {
      showGraph: Boolean(options.graph),
    })

    if (options.sync) {
      await runSyncOrCompare(options.sync, { dryRun: false, isExcluded })
      return
    }

    if (options.compare) {
      await runSyncOrCompare(options.compare, { dryRun: true, isExcluded })
      return
    }

    if (options.scan) {
      const result = await runScan(options.scan, allFiles)
      if (result.hasChanges) {
        process.exitCode = 1
      }
      return
    }

    if (options.graph) {
      log.success('Dependency graph printed')
      return
    }

    log.success('Dependency analysis complete (pass --graph to print the graph)')
  })

program.parseAsync(process.argv).catch((error) => {
  // Logger may not be ready if failure is during parse; still prefer it when available.
  if (log?.error) {
    log.error(error.message ?? error)
  } else {
    console.error(error)
  }
  process.exit(1)
})
