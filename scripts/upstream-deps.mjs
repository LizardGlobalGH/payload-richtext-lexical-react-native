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
 *   node scripts/upstream-deps.mjs <files-or-folders...> --clean
 *   node scripts/upstream-deps.mjs <files-or-folders...> --clean src
 *
 * --clean removes files under the given folder (default: src) that are not in
 * the dependency graph and not matched by include (include patterns that cover
 * the clean root itself are ignored so cleaning src with include:["src"] still
 * prunes unused files).
 *   node scripts/upstream-deps.mjs <files-or-folders...> --sync <upstream> --include src --exclude src/foo --config ./scripts/upstream-deps.json
 *
 * Config file (JSON object):
 *   {
 *     "include": ["src", "package.json", "tsconfig.json"],
 *     "exclude": ["README.md"],
 *     "partial": {
 *       "package.json": {
 *         "keys": {
 *           "include": ["dependencies", "devDependencies.typescript"],
 *           "exclude": ["name", "version", "scripts"]
 *         }
 *       },
 *       "src/example.ts": {
 *         "lines": {
 *           "include": [[10, 40]],
 *           "exclude": [[1, 5], [100, 120]]
 *         }
 *       }
 *     }
 *   }
 *
 * "include" (optional): when set, sync/compare only these files/folders.
 * "exclude": always skipped during sync. "partial" wins over exclude for the same path.
 * "keep": files/folders never removed by --clean (even if outside the dependency graph).
 * CLI --include / --exclude / --keep fully override the corresponding config lists when provided.
 * For each partial file, use either keys (JSON) or lines (text), and either
 * include or exclude mode (not both). Nested JSON keys use dot paths; keys that
 * contain dots must use brackets, e.g. exports["./react-native"], or an array
 * path: ["exports", "./react-native"].
 * Line ranges are 1-based and inclusive: [start, end].
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
  writeFile,
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
// Exclusion list / config / partial updates
// ---------------------------------------------------------------------------

function collectOption(value, previous) {
  return previous.concat([value])
}

/**
 * Normalize a user-provided path to a project-relative posix path.
 */
function normalizeProjectPath(raw) {
  let value = String(raw).trim()
  if (!value) return null

  value = value.replace(/\\/g, '/').replace(/\/+$/, '')

  if (isAbsolute(value)) {
    value = toPosix(relative(PROJECT_ROOT, value))
  }

  if (value.startsWith('./')) {
    value = value.slice(2)
  }

  if (!value || value.startsWith('..')) {
    throw new Error(`Path must be inside the project: ${raw}`)
  }

  return value
}

/**
 * Build a path matcher for include/exclude patterns (files or folders).
 * A folder pattern matches the folder itself and every path under it.
 */
function createPathMatcher(patterns) {
  const normalized = []
  for (const pattern of patterns) {
    const next = normalizeProjectPath(pattern)
    if (next) normalized.push(next)
  }

  const unique = [...new Set(normalized)].sort()

  const matches = (relPath) => {
    const rel = toPosix(relPath).replace(/^\.\//, '')
    for (const pattern of unique) {
      if (rel === pattern || rel.startsWith(`${pattern}/`)) {
        return true
      }
    }
    return false
  }

  return { patterns: unique, matches }
}

function filterTreeByInclude(tree, isIncluded) {
  /** @type {Map<string, string>} */
  const filtered = new Map()
  for (const [rel, abs] of tree) {
    if (isIncluded(rel)) filtered.set(rel, abs)
  }
  return filtered
}

function deepClone(value) {
  return structuredClone(value)
}

/**
 * Parse a nested key path.
 * Supports:
 *   - dot paths: "a.b.c"
 *   - bracket segments for keys that contain dots: exports["./react-native"]
 *   - pre-split arrays: ["exports", "./react-native"]
 */
function parseKeyPath(path) {
  if (Array.isArray(path)) {
    if (path.length === 0 || path.some((part) => typeof part !== 'string' || part.length === 0)) {
      throw new Error(`Key path array must be a non-empty list of non-empty strings: ${JSON.stringify(path)}`)
    }
    return path
  }

  const input = String(path)
  const parts = []
  let i = 0

  while (i < input.length) {
    if (input[i] === '.' ) {
      i += 1
      continue
    }

    if (input[i] === '[') {
      const quote = input[i + 1]
      if (quote !== '"' && quote !== "'") {
        throw new Error(`Key path bracket segment must be quoted: ${input}`)
      }
      i += 2
      let value = ''
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1]
          i += 2
          continue
        }
        value += input[i]
        i += 1
      }
      if (input[i] !== quote || input[i + 1] !== ']') {
        throw new Error(`Unterminated bracket key segment in path: ${input}`)
      }
      parts.push(value)
      i += 2
      continue
    }

    let value = ''
    while (i < input.length && input[i] !== '.' && input[i] !== '[') {
      value += input[i]
      i += 1
    }
    if (!value) {
      throw new Error(`Empty key segment in path: ${input}`)
    }
    parts.push(value)
  }

  if (parts.length === 0) {
    throw new Error(`Empty key path: ${input}`)
  }

  return parts
}

function normalizeKeyPathList(list, context) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${context} must be a non-empty array`)
  }

  return list.map((item, index) => {
    if (typeof item === 'string' || Array.isArray(item)) {
      // Validate eagerly
      parseKeyPath(item)
      return item
    }
    throw new Error(
      `${context}[${index}] must be a string or string array (got ${typeof item})`,
    )
  })
}

function hasAt(obj, path) {
  const parts = parseKeyPath(path)
  let cur = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) {
      return false
    }
    cur = cur[part]
  }
  return true
}

function getAt(obj, path) {
  const parts = parseKeyPath(path)
  let cur = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) {
      return undefined
    }
    cur = cur[part]
  }
  return cur
}

function setAt(obj, path, value) {
  const parts = parseKeyPath(path)
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (cur[part] === null || typeof cur[part] !== 'object') {
      cur[part] = {}
    }
    cur = cur[part]
  }
  cur[parts[parts.length - 1]] = value
}

function deleteAt(obj, path) {
  const parts = parseKeyPath(path)
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) {
      return
    }
    cur = cur[part]
  }
  if (cur !== null && typeof cur === 'object') {
    delete cur[parts[parts.length - 1]]
  }
}

function detectJsonIndent(text) {
  const match = text.match(/\n([ \t]+)"/)
  return match ? match[1] : '    '
}

function formatJson(value, indent, hadTrailingNewline) {
  const body = `${JSON.stringify(value, null, indent)}\n`
  return hadTrailingNewline ? body : body.replace(/\n$/, '')
}

/**
 * Validate and normalize a line range list: [[start, end], ...] (1-based, inclusive).
 */
function normalizeLineRanges(ranges, context) {
  if (!Array.isArray(ranges)) {
    throw new Error(`${context} must be an array of [start, end] ranges`)
  }

  return ranges.map((range, index) => {
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error(`${context}[${index}] must be a [start, end] pair`)
    }
    const start = Number(range[0])
    const end = Number(range[1])
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error(
        `${context}[${index}] must be integers with 1 <= start <= end (got ${JSON.stringify(range)})`,
      )
    }
    return [start, end]
  })
}

function lineInRanges(lineNumber, ranges) {
  return ranges.some(([start, end]) => lineNumber >= start && lineNumber <= end)
}

/**
 * Parse one partial file rule.
 * @returns {{ type: 'keys'|'lines', mode: 'include'|'exclude', paths?: string[], ranges?: number[][] }}
 */
function parsePartialRule(relPath, rule, context) {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error(`${context}: rule must be an object`)
  }

  const hasKeys = Object.hasOwn(rule, 'keys')
  const hasLines = Object.hasOwn(rule, 'lines')
  if (hasKeys === hasLines) {
    throw new Error(`${context}: specify exactly one of "keys" or "lines"`)
  }

  if (hasKeys) {
    const keys = rule.keys
    if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new Error(`${context}.keys must be an object`)
    }
    const hasInclude = Object.hasOwn(keys, 'include')
    const hasExclude = Object.hasOwn(keys, 'exclude')
    if (hasInclude === hasExclude) {
      throw new Error(`${context}.keys: specify exactly one of "include" or "exclude"`)
    }
    const mode = hasInclude ? 'include' : 'exclude'
    const list = normalizeKeyPathList(keys[mode], `${context}.keys.${mode}`)
    if (extname(relPath).toLowerCase() !== '.json') {
      log.warn(`${context}: "keys" is intended for JSON files (${relPath})`)
    }
    return { type: 'keys', mode, paths: list }
  }

  const lines = rule.lines
  if (lines === null || typeof lines !== 'object' || Array.isArray(lines)) {
    throw new Error(`${context}.lines must be an object`)
  }
  const hasInclude = Object.hasOwn(lines, 'include')
  const hasExclude = Object.hasOwn(lines, 'exclude')
  if (hasInclude === hasExclude) {
    throw new Error(`${context}.lines: specify exactly one of "include" or "exclude"`)
  }
  const mode = hasInclude ? 'include' : 'exclude'
  const ranges = normalizeLineRanges(lines[mode], `${context}.lines.${mode}`)
  if (ranges.length === 0) {
    throw new Error(`${context}.lines.${mode} must contain at least one range`)
  }
  return { type: 'lines', mode, ranges }
}

/**
 * Merge JSON content according to a keys include/exclude rule.
 * Returns { text, changedPaths } where changedPaths lists key paths taken from upstream.
 */
function mergeJsonByKeys(localText, upstreamText, rule) {
  let localValue
  let upstreamValue
  try {
    localValue = localText.trim() === '' ? {} : JSON.parse(localText)
  } catch (error) {
    throw new Error(`Local JSON parse failed: ${error.message}`)
  }
  try {
    upstreamValue = upstreamText.trim() === '' ? {} : JSON.parse(upstreamText)
  } catch (error) {
    throw new Error(`Upstream JSON parse failed: ${error.message}`)
  }

  if (
    localValue === null ||
    typeof localValue !== 'object' ||
    Array.isArray(localValue) ||
    upstreamValue === null ||
    typeof upstreamValue !== 'object' ||
    Array.isArray(upstreamValue)
  ) {
    throw new Error('Partial JSON key sync requires object roots (not arrays/primitives)')
  }

  const changedPaths = []
  let result

  if (rule.mode === 'include') {
    result = deepClone(localValue)
    for (const path of rule.paths) {
      if (hasAt(upstreamValue, path)) {
        setAt(result, path, deepClone(getAt(upstreamValue, path)))
        changedPaths.push(path)
      } else if (hasAt(result, path)) {
        deleteAt(result, path)
        changedPaths.push(path)
      }
    }
  } else {
    result = deepClone(upstreamValue)
    for (const path of rule.paths) {
      if (hasAt(localValue, path)) {
        setAt(result, path, deepClone(getAt(localValue, path)))
      } else {
        deleteAt(result, path)
      }
    }
  }

  const indent = detectJsonIndent(localText || upstreamText)
  const hadTrailingNewline = (localText || upstreamText).endsWith('\n')
  const text = formatJson(result, indent, hadTrailingNewline)

  return { text, changedPaths, mode: rule.mode }
}

/**
 * Merge text files by 1-based inclusive line ranges.
 */
function mergeTextByLines(localText, upstreamText, rule) {
  const localLines = localText.split('\n')
  const upstreamLines = upstreamText.split('\n')
  // Preserve whether original had trailing newline via split behavior:
  // 'a\n'.split('\n') => ['a', '']; 'a'.split('\n') => ['a']
  const maxLen = Math.max(localLines.length, upstreamLines.length)
  const result = []
  const changedLines = []

  const allowed = (lineNumber) => {
    const inRanges = lineInRanges(lineNumber, rule.ranges)
    return rule.mode === 'include' ? inRanges : !inRanges
  }

  for (let i = 1; i <= maxLen; i++) {
    const localLine = i <= localLines.length ? localLines[i - 1] : undefined
    const upstreamLine = i <= upstreamLines.length ? upstreamLines[i - 1] : undefined

    if (allowed(i)) {
      if (upstreamLine !== undefined) {
        result.push(upstreamLine)
        if (upstreamLine !== localLine) changedLines.push(i)
      } else if (localLine !== undefined) {
        // Upstream shorter: drop local-only line only when updating that region
        // Keep local if include/exclude still "allows" but upstream has nothing —
        // for include, omit; for exclude (allowed=true means not protected), omit extra local lines
        // beyond upstream so file shrinks with upstream.
      }
    } else if (localLine !== undefined) {
      result.push(localLine)
    }
  }

  // Re-join; if both inputs ended with \n, split produced trailing ''; keep that shape
  const text = result.join('\n')
  return { text, changedLines, mode: rule.mode }
}

async function applyPartialMerge(rel, sourceAbs, destAbs, rule) {
  const upstreamText = await readFile(sourceAbs, 'utf8')
  const localExists = await fileExists(destAbs)
  const localText = localExists ? await readFile(destAbs, 'utf8') : rule.type === 'keys' ? '{}\n' : ''

  if (rule.type === 'keys') {
    return mergeJsonByKeys(localText, upstreamText, rule)
  }
  return mergeTextByLines(localText, upstreamText, rule)
}

/**
 * Load a JSON config file. Must be a plain object with keys.
 * Supported keys:
 *   - include: string[] — when set, only these files/folders are synced/compared
 *   - exclude: string[] — files/folders skipped during sync/compare
 *   - keep: string[] — files/folders never removed by --clean
 *   - partial: { [relativePath]: { keys|lines: { include|exclude: ... } } }
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

  const knownKeys = new Set(['include', 'exclude', 'keep', 'partial'])
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) {
      log.warn(`Unknown config key "${key}" in ${configPath} (ignored)`)
    }
  }

  const include = parsed.include ?? []
  if (!Array.isArray(include) || include.some((item) => typeof item !== 'string')) {
    throw new Error(`Config key "include" must be an array of strings: ${configPath}`)
  }

  const exclude = parsed.exclude ?? []
  if (!Array.isArray(exclude) || exclude.some((item) => typeof item !== 'string')) {
    throw new Error(`Config key "exclude" must be an array of strings: ${configPath}`)
  }

  const keep = parsed.keep ?? []
  if (!Array.isArray(keep) || keep.some((item) => typeof item !== 'string')) {
    throw new Error(`Config key "keep" must be an array of strings: ${configPath}`)
  }

  /** @type {Map<string, ReturnType<typeof parsePartialRule>>} */
  const partial = new Map()
  const partialRaw = parsed.partial ?? {}
  if (partialRaw === null || typeof partialRaw !== 'object' || Array.isArray(partialRaw)) {
    throw new Error(`Config key "partial" must be an object: ${configPath}`)
  }

  for (const [rawPath, rule] of Object.entries(partialRaw)) {
    const rel = normalizeProjectPath(rawPath)
    if (!rel) continue
    partial.set(rel, parsePartialRule(rel, rule, `partial["${rel}"]`))
  }

  log.info(`Loaded config from ${abs}`)
  log.debug(`Config keys: ${Object.keys(parsed).join(', ') || '(none)'}`)

  return { include, exclude, keep, partial }
}

/**
 * Resolve CLI include/exclude/keep with config lists / config.partial.
 * Non-empty CLI lists fully replace the corresponding config lists.
 */
async function resolveSyncConfig({
  includeFromCli = [],
  excludeFromCli = [],
  keepFromCli = [],
  configPath,
}) {
  /** @type {string[]} */
  const includeFromConfig = []
  /** @type {string[]} */
  const excludeFromConfig = []
  /** @type {string[]} */
  const keepFromConfig = []
  /** @type {Map<string, ReturnType<typeof parsePartialRule>>} */
  let partial = new Map()

  if (configPath) {
    const config = await loadConfigFile(configPath)
    includeFromConfig.push(...config.include)
    excludeFromConfig.push(...config.exclude)
    keepFromConfig.push(...config.keep)
    partial = config.partial
  }

  const includePatterns = includeFromCli.length > 0 ? includeFromCli : includeFromConfig
  const excludePatterns = excludeFromCli.length > 0 ? excludeFromCli : excludeFromConfig
  const keepPatterns = keepFromCli.length > 0 ? keepFromCli : keepFromConfig

  if (includeFromCli.length > 0 && includeFromConfig.length > 0) {
    log.info('CLI --include overrides config "include"')
  }
  if (excludeFromCli.length > 0 && excludeFromConfig.length > 0) {
    log.info('CLI --exclude overrides config "exclude"')
  }
  if (keepFromCli.length > 0 && keepFromConfig.length > 0) {
    log.info('CLI --keep overrides config "keep"')
  }

  // Partial rules take precedence over full exclude for the same path
  const excludeFiltered = excludePatterns.filter((pattern) => {
    const rel = normalizeProjectPath(pattern)
    if (rel && partial.has(rel)) {
      log.warn(`"${rel}" is in both exclude and partial — using partial rules`)
      return false
    }
    return true
  })

  const includeMatcher = createPathMatcher(includePatterns)
  const excludeMatcher = createPathMatcher(excludeFiltered)
  const keepMatcher = createPathMatcher(keepPatterns)

  const includeEnabled = includeMatcher.patterns.length > 0

  const isIncluded = (relPath) => {
    if (!includeEnabled) return true
    return includeMatcher.matches(relPath)
  }

  const isExcluded = (relPath) => {
    const rel = toPosix(relPath).replace(/^\.\//, '')
    if (partial.has(rel)) return false
    return excludeMatcher.matches(rel)
  }

  if (includeEnabled) {
    log.info(`Include list (${includeMatcher.patterns.length}) — sync limited to:`)
    for (const pattern of includeMatcher.patterns) {
      log.info(`  + ${pattern}`)
    }
  } else {
    log.debug('No include filter configured (all files eligible)')
  }

  if (excludeMatcher.patterns.length > 0) {
    log.info(`Exclusion list (${excludeMatcher.patterns.length}):`)
    for (const pattern of excludeMatcher.patterns) {
      log.info(`  - ${pattern}`)
    }
  } else {
    log.debug('No exclusion patterns configured')
  }

  if (keepMatcher.patterns.length > 0) {
    log.info(`Clean keep list (${keepMatcher.patterns.length}) — never removed by --clean:`)
    for (const pattern of keepMatcher.patterns) {
      log.info(`  * ${pattern}`)
    }
  } else {
    log.debug('No clean keep patterns configured')
  }

  if (partial.size > 0) {
    log.info(`Partial update rules (${partial.size}):`)
    for (const [rel, rule] of [...partial.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (includeEnabled && !isIncluded(rel)) {
        log.warn(`  - ${rel}  (partial rule ignored — path not in include list)`)
        continue
      }
      if (rule.type === 'keys') {
        const rendered = rule.paths
          .map((path) => (Array.isArray(path) ? JSON.stringify(path) : path))
          .join(', ')
        log.info(`  - ${rel}  (keys ${rule.mode}: ${rendered})`)
      } else {
        const ranges = rule.ranges.map(([s, e]) => `${s}-${e}`).join(', ')
        log.info(`  - ${rel}  (lines ${rule.mode}: ${ranges})`)
      }
    }
  }

  return {
    isIncluded,
    matchesInclude: (relPath) => includeMatcher.matches(relPath),
    includePatterns: includeMatcher.patterns,
    keepPatterns: keepMatcher.patterns,
    isExcluded,
    getPartialRule: (relPath) => {
      const rel = toPosix(relPath).replace(/^\.\//, '')
      if (includeEnabled && !isIncluded(rel)) return null
      return partial.get(rel) ?? null
    },
    partial,
    includeEnabled,
  }
}

/**
 * Split a sync/compare diff into actionable, partial, and excluded buckets.
 */
function partitionDiff(diff, { isExcluded, getPartialRule }) {
  const split = (list) => {
    const actionable = []
    const partial = []
    const excluded = []
    for (const rel of list) {
      if (getPartialRule(rel)) partial.push(rel)
      else if (isExcluded(rel)) excluded.push(rel)
      else actionable.push(rel)
    }
    return { actionable, partial, excluded }
  }

  const added = split(diff.added)
  const modified = split(diff.modified)
  const removed = split(diff.removed)

  const unchanged = diff.unchanged.filter((rel) => !isExcluded(rel) && !getPartialRule(rel))

  return {
    actionable: {
      added: added.actionable,
      modified: modified.actionable,
      removed: removed.actionable,
      unchanged,
    },
    partial: {
      added: added.partial,
      modified: modified.partial,
      removed: removed.partial,
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

function printTreeDiff(diff, { dryRun, excludedDiff, partialDiff }) {
  const verb = dryRun ? 'Would' : 'Will'
  log.info(`${dryRun ? 'Compare' : 'Sync'} summary:`)
  log.info(`  added:     ${diff.added.length}`)
  log.info(`  modified:  ${diff.modified.length}`)
  log.info(`  removed:   ${diff.removed.length}`)
  log.info(`  unchanged: ${diff.unchanged.length}`)
  if (partialDiff) {
    const partialCount =
      partialDiff.added.length + partialDiff.modified.length + partialDiff.removed.length
    log.info(`  partial:   ${partialCount}`)
  }
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

async function applyFullSync(sourceTree, projectRoot, diff) {
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

/**
 * Apply or preview partial merges. Returns stats.
 */
async function processPartialFiles(partialDiff, sourceTree, { getPartialRule, dryRun }) {
  const updates = []
  const skippedProtected = []
  const removalBlocked = []

  for (const rel of partialDiff.removed) {
    removalBlocked.push(rel)
    log.warn(`  ! ${rel}  (partial rule set — will not remove; delete upstream file manually if intended)`)
  }

  for (const rel of [...partialDiff.added, ...partialDiff.modified]) {
    const rule = getPartialRule(rel)
    const sourceAbs = sourceTree.get(rel)
    const destAbs = join(PROJECT_ROOT, rel)

    try {
      const localExists = await fileExists(destAbs)
      const localText = localExists ? await readFile(destAbs, 'utf8') : ''
      const merged = await applyPartialMerge(rel, sourceAbs, destAbs, rule)

      if (merged.text === localText) {
        skippedProtected.push(rel)
        log.warn(
          `  ~ ${rel}  (partial: no allowed changes; protected regions still differ from upstream)`,
        )
        continue
      }

      updates.push(rel)
      if (rule.type === 'keys') {
        const detail =
          rule.mode === 'include'
            ? `keys include ${rule.paths.join(', ')}`
            : `keys exclude ${rule.paths.join(', ')}`
        log.info(`  ~ ${rel}  (${dryRun ? 'would partially update' : 'partial update'}: ${detail})`)
        if (merged.changedPaths?.length) {
          for (const path of merged.changedPaths) {
            log.debug(`      key ${path}`)
          }
        }
      } else {
        const ranges = rule.ranges.map(([s, e]) => `${s}-${e}`).join(', ')
        const detail = `lines ${rule.mode} ${ranges}`
        log.info(`  ~ ${rel}  (${dryRun ? 'would partially update' : 'partial update'}: ${detail})`)
        if (merged.changedLines?.length) {
          log.debug(`      lines: ${merged.changedLines.join(', ')}`)
        }
      }

      if (!dryRun) {
        await ensureParentDir(destAbs)
        await writeFile(destAbs, merged.text, 'utf8')
      }
    } catch (error) {
      log.error(`Partial update failed for ${rel}: ${error.message}`)
      throw error
    }
  }

  return { updates, skippedProtected, removalBlocked }
}

async function runSyncOrCompare(upstreamPath, { dryRun, isIncluded, isExcluded, getPartialRule }) {
  const upstream = await resolveUpstream(upstreamPath)
  log.info(`${dryRun ? 'Comparing' : 'Syncing'} from ${upstream}`)
  log.info(`Target project: ${PROJECT_ROOT}`)

  const sourceTreeAll = await collectRelativeTree(upstream)
  const sourceTree = filterTreeByInclude(sourceTreeAll, isIncluded)
  const destTreeAll = await collectManagedDestTree(PROJECT_ROOT, sourceTreeAll)
  const destTree = filterTreeByInclude(destTreeAll, isIncluded)

  if (sourceTree.size !== sourceTreeAll.size) {
    log.info(
      `Include filter: ${sourceTree.size}/${sourceTreeAll.size} upstream files in scope`,
    )
  }

  log.debug(`Upstream files (in scope): ${sourceTree.size}`)
  log.debug(`Managed project files (in scope): ${destTree.size}`)

  const fullDiff = await diffTrees(sourceTree, destTree)
  const { actionable, partial, excluded } = partitionDiff(fullDiff, { isExcluded, getPartialRule })

  printTreeDiff(actionable, { dryRun, excludedDiff: excluded, partialDiff: partial })
  warnExcludedEdits(excluded, { dryRun })

  if (partial.added.length + partial.modified.length + partial.removed.length > 0) {
    log.info(`Partial updates (${dryRun ? 'preview' : 'apply'}):`)
  }
  const partialStats = await processPartialFiles(partial, sourceTree, { getPartialRule, dryRun })

  if (dryRun) {
    log.success('Compare complete (no files were changed)')
    return { actionable, partial, excluded, partialStats }
  }

  await applyFullSync(sourceTree, PROJECT_ROOT, actionable)
  log.success(
    `Sync complete (${actionable.added.length} added, ${actionable.modified.length} updated, ${actionable.removed.length} removed, ${partialStats.updates.length} partial, ${excluded.added.length + excluded.modified.length + excluded.removed.length} excluded skipped)`,
  )
  return { actionable, partial, excluded, partialStats }
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
// Clean (remove files outside dependency graph ∪ include list)
// ---------------------------------------------------------------------------

/**
 * Remove files under `cleanRoot` that are not in the dependency graph,
 * not matched by include (except patterns covering the clean root), and not
 * matched by the keep list. Keep file entries are expanded through their
 * local dependency graphs so listing an export entry is enough to preserve
 * what it needs to build. Empty directories are removed afterward
 * (the clean root itself is kept).
 */
async function runClean(cleanRootArg, { allFiles, includePatterns, keepPatterns }) {
  const cleanRoot = isAbsolute(cleanRootArg)
    ? cleanRootArg
    : resolve(PROJECT_ROOT, cleanRootArg)
  const cleanRel = toPosix(relative(PROJECT_ROOT, cleanRoot))

  if (cleanRel.startsWith('..') || isAbsolute(cleanRel)) {
    throw new Error(`Clean path must be inside the project: ${cleanRootArg}`)
  }

  if (!(await fileExists(cleanRoot))) {
    throw new Error(`Clean path does not exist: ${cleanRoot}`)
  }

  const cleanStat = await stat(cleanRoot)
  if (!cleanStat.isDirectory()) {
    throw new Error(`Clean path must be a directory: ${cleanRoot}`)
  }

  const graphKeep = new Set(
    allFiles.map((abs) => toPosix(relative(PROJECT_ROOT, abs))).filter(Boolean),
  )

  const cleanKey = cleanRel || '.'
  const keepIncludePatterns = (includePatterns ?? []).filter((pattern) => {
    // Ignore patterns that cover the entire clean root
    if (pattern === cleanKey) return false
    if (cleanKey !== '.' && cleanKey.startsWith(`${pattern}/`)) return false
    return true
  })

  const ignoredIncludePatterns = (includePatterns ?? []).filter(
    (pattern) => !keepIncludePatterns.includes(pattern),
  )
  if (ignoredIncludePatterns.length > 0) {
    log.warn(
      `Ignoring include pattern(s) for clean keep-set because they cover the clean root: ${ignoredIncludePatterns.join(', ')}`,
    )
  }

  // Split keep patterns: existing files → expand deps; folders/globs → path matcher
  const keepFileEntries = []
  const keepFolderPatterns = []
  for (const pattern of keepPatterns ?? []) {
    const abs = join(PROJECT_ROOT, pattern)
    try {
      const s = await stat(abs)
      if (s.isFile()) {
        keepFileEntries.push(abs)
        continue
      }
    } catch {
      // missing path — still treat as folder/prefix pattern
    }
    keepFolderPatterns.push(pattern)
  }

  if (keepFileEntries.length > 0) {
    log.info(
      `Expanding dependency graph for ${keepFileEntries.length} keep file(s)`,
    )
    const { allFiles: keepDeps } = await buildDependencyGraph(keepFileEntries)
    for (const abs of keepDeps) {
      graphKeep.add(toPosix(relative(PROJECT_ROOT, abs)))
    }
    log.info(`  keep graph size: ${keepDeps.length}`)
  }

  const keepIncludeMatcher = createPathMatcher(keepIncludePatterns)
  const cleanKeepMatcher = createPathMatcher(keepFolderPatterns)
  const shouldKeep = (rel) =>
    graphKeep.has(rel) || keepIncludeMatcher.matches(rel) || cleanKeepMatcher.matches(rel)

  const files = await collectFiles(cleanRoot)
  const toRemove = []
  const kept = []

  for (const abs of files) {
    const rel = toPosix(relative(PROJECT_ROOT, abs))
    if (shouldKeep(rel)) {
      kept.push(rel)
    } else {
      toRemove.push(rel)
    }
  }

  toRemove.sort()
  kept.sort()

  log.info(`Clean root: ${cleanKey}`)
  log.info(`  kept:    ${kept.length}`)
  log.info(`  remove:  ${toRemove.length}`)

  for (const rel of toRemove) {
    log.info(`  - ${rel}`)
  }
  for (const rel of kept) {
    log.debug(`  keep ${rel}`)
  }

  for (const rel of toRemove) {
    await rm(join(PROJECT_ROOT, rel), { force: true })
    log.debug(`Removed ${rel}`)
  }

  // Remove empty directories deepest-first; never remove the clean root itself
  async function removeEmptyDirs(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isDotDirName(entry.name)) continue
      if (ALWAYS_SKIP_DIR_NAMES.has(entry.name)) continue
      await removeEmptyDirs(join(dir, entry.name))
    }

    if (dir === cleanRoot) return

    try {
      const remaining = await readdir(dir)
      if (remaining.length === 0) {
        await rm(dir, { recursive: true, force: true })
        log.debug(`Removed empty directory ${toPosix(relative(PROJECT_ROOT, dir))}`)
      }
    } catch {
      // gone
    }
  }

  await removeEmptyDirs(cleanRoot)

  log.success(`Clean complete (${toRemove.length} removed, ${kept.length} kept under ${cleanKey})`)
  return { removed: toRemove, kept }
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
    '--include <path>',
    'only sync/compare this file or folder (repeatable; overrides config "include" when set)',
    collectOption,
    [],
  )
  .option(
    '--exclude <path>',
    'file or folder to skip during sync/compare (repeatable; overrides config "exclude" when set)',
    collectOption,
    [],
  )
  .option(
    '--keep <path>',
    'file or folder never removed by --clean (repeatable; overrides config "keep" when set)',
    collectOption,
    [],
  )
  .option(
    '-c, --config <path>',
    'JSON config file path (object with keys; supports "include", "exclude", "keep", and "partial")',
  )
  .option(
    '--clean [path]',
    'remove files/folders under path that are not in the dependency graph or include list (default: src)',
  )
  .option('--debug', 'enable debug logging', false)
  .action(async (paths, options) => {
    log = createLogger(Boolean(options.debug))

    const modes = [options.sync, options.compare, options.scan].filter(Boolean)
    if (modes.length > 1) {
      throw new Error('Use only one of --sync, --compare, or --scan')
    }

    const cleanRequested = options.clean !== undefined
    const cleanPath =
      typeof options.clean === 'string' && options.clean.length > 0 ? options.clean : 'src'

    log.info(`Project root: ${PROJECT_ROOT}`)
    log.debug(`Entry paths: ${paths.join(', ')}`)

    const { isIncluded, isExcluded, getPartialRule, includePatterns, keepPatterns } =
      await resolveSyncConfig({
        includeFromCli: options.include ?? [],
        excludeFromCli: options.exclude ?? [],
        keepFromCli: options.keep ?? [],
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
      await runSyncOrCompare(options.sync, {
        dryRun: false,
        isIncluded,
        isExcluded,
        getPartialRule,
      })
    } else if (options.compare) {
      await runSyncOrCompare(options.compare, {
        dryRun: true,
        isIncluded,
        isExcluded,
        getPartialRule,
      })
    } else if (options.scan) {
      const result = await runScan(options.scan, allFiles)
      if (result.hasChanges) {
        process.exitCode = 1
      }
    } else if (options.graph && !cleanRequested) {
      log.success('Dependency graph printed')
    } else if (!cleanRequested) {
      log.success('Dependency analysis complete (pass --graph to print the graph)')
    }

    if (cleanRequested) {
      await runClean(cleanPath, {
        allFiles,
        includePatterns,
        keepPatterns,
      })
    }
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
