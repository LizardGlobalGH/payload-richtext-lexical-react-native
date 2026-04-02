#!/usr/bin/env node

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const program = new Command()

program
  .name('internal-install')
  .description('Build the package and copy dist output into a local module directory')
  .requiredOption('-t, --target <path>', 'target directory to receive built files')
  .option('--skip-build', 'skip running "pnpm build" before copying', false)
  .action(async (options) => {
    const targetDir = resolve(process.cwd(), options.target)
    const distDir = resolve(process.cwd(), 'dist')

    if (!options.skipBuild) {
      await runCommand('pnpm', ['build'])
    }

    await mkdir(targetDir, { recursive: true })

    const entries = await readdir(targetDir)
    await Promise.all(
      entries.map((entry) => rm(resolve(targetDir, entry), { force: true, recursive: true })),
    )

    await cp(distDir, targetDir, { force: true, recursive: true })

    console.log(`Installed dist into ${targetDir}`)
  })

program.parseAsync(process.argv).catch((error) => {
  console.error(error)
  process.exit(1)
})

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`))
    })

    child.on('error', rejectPromise)
  })
}
