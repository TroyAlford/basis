#!/usr/bin/env bun
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

  const result = Bun.spawnSync([process.execPath, husky], {
    cwd: root,
    stderr: 'inherit',
    stdout: 'inherit',
  })

  if (!result.success) process.exit(result.exitCode)
}

prepare()
