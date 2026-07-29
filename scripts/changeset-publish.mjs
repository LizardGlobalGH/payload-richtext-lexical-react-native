#!/usr/bin/env node
/**
 * Runs `changeset publish` without pnpm-only npm_config_* env vars.
 * Those leak when invoked via `pnpm run` and break npm 11+
 * (e.g. EUNKNOWNCONFIG --git-checks). Changesets still uses pnpm to publish
 * when a pnpm-lock.yaml is present.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const changesetBin = path.join(root, 'node_modules', '@changesets', 'cli', 'bin.js')

const env = { ...process.env }
for (const key of Object.keys(env)) {
  const lower = key.toLowerCase()
  if (
    lower === 'npm_config_git_checks' ||
    lower === 'npm_config_verify_deps_before_run' ||
    lower === 'npm_config_always_auth' ||
    lower === 'npm_config__jsr_registry'
  ) {
    delete env[key]
  }
}

const result = spawnSync(process.execPath, [changesetBin, 'publish'], {
  cwd: root,
  env,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)