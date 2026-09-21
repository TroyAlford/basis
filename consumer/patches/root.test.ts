import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInstallRoot } from './root'

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), 'basis-root-'))

const makeProject = (root: string): void => {
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app' }))
}

describe('resolveInstallRoot', () => {
  test('prefers INIT_CWD when the library hook runs', () => {
    const project = makeTempDir()
    makeProject(project)
    expect(resolveInstallRoot(join(project, 'node_modules', 'basis'), { initCwd: project })).toBe(project)
  })

  test('uses the working directory for CLI commands', () => {
    const project = makeTempDir()
    makeProject(project)
    expect(
      resolveInstallRoot(join(project, 'node_modules', 'basis'), { cwd: project, initCwd: null }),
    ).toBe(project)
  })

  test('walks out of the isolated .bun store to the application root', () => {
    const project = makeTempDir()
    makeProject(project)
    const basisDir = join(project, 'node_modules', '.bun', 'basis@1.0.0+abc', 'node_modules', 'basis')
    mkdirSync(basisDir, { recursive: true })
    writeFileSync(join(basisDir, 'package.json'), JSON.stringify({ name: 'basis' }))

    expect(resolveInstallRoot(basisDir, { cwd: makeTempDir(), initCwd: null })).toBe(project)
  })
})
