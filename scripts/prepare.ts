#!/usr/bin/env bun
import { run } from 'basis/configuration'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the repository's `prepare` lifecycle so Husky only installs its git
 * hooks when Basis is checked out for development. Bun also runs `prepare` for
 * Git dependencies, where Husky is not installed and must be skipped.
 */
const prepare = (): void => {
  const root = join(import.meta.dir, '..')
  const husky = join(root, 'node_modules', 'husky', 'bin.js')

  if (!existsSync(join(root, '.git')) || !existsSync(husky)) return

  const result = run(process.execPath, [husky], { cwd: root })
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

prepare()
