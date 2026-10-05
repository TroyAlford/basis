import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkHostDependencies, readHostDependencies, requireHostDependencies } from './host-dependencies'

/** Temporary directories to remove after each test. */
const directories: string[] = []

/**
 * Write a consumer manifest into a fresh temporary directory.
 * @param manifest - Value serialized as `package.json`.
 * @returns The fixture directory.
 */
function fixture(manifest: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'basis-host-deps-'))
  directories.push(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('readHostDependencies', () => {
  test('returns an empty list when nothing is declared', () => {
    expect(readHostDependencies(fixture({ name: 'app' }))).toEqual([])
    expect(readHostDependencies(fixture({ basis: {}, name: 'app' }))).toEqual([])
  })

  test('reads the declared array', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'op'] }, name: 'app' })
    expect(readHostDependencies(directory)).toEqual(['docker', 'op'])
  })

  test('fails loudly when the basis field is not an object', () => {
    expect(() => readHostDependencies(fixture({ basis: ['docker'] }))).toThrow(/"basis".*must be an object/)
  })

  test('fails loudly when hostDependencies is not an array', () => {
    expect(() => readHostDependencies(fixture({ basis: { hostDependencies: 'docker' } })))
      .toThrow(/hostDependencies.*must be an array/)
  })

  test('fails loudly when the manifest is unreadable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'basis-host-deps-'))
    directories.push(directory)
    expect(() => readHostDependencies(directory)).toThrow(/could not read/)
  })
})

describe('checkHostDependencies', () => {
  test('splits resolved, missing, and malformed declarations', () => {
    const resolve = (command: string): string | null => (command === 'docker' ? '/usr/bin/docker' : null)
    const check = checkHostDependencies(['docker', 'op', '', 42], resolve)

    expect(check.resolved).toEqual(['docker'])
    expect(check.missing).toEqual(['op'])
    expect(check.broken).toEqual(['""', '42'])
  })

  test('never throws', () => {
    expect(() => checkHostDependencies(['op'], () => null)).not.toThrow()
  })
})

describe('requireHostDependencies', () => {
  test('returns the resolved capabilities when every declaration is satisfied', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'op'] }, name: 'app' })
    const check = requireHostDependencies(directory, { resolve: () => '/usr/bin/x' })

    expect(check.resolved).toEqual(['docker', 'op'])
  })

  test('fails loudly naming every missing capability', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'op', 'lego'] }, name: 'app' })
    const resolve = (command: string): string | null => (command === 'docker' ? '/usr/bin/docker' : null)

    expect(() => requireHostDependencies(directory, { resolve })).toThrow(/op, lego/)
  })

  test('fails loudly naming every malformed declaration', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', null] }, name: 'app' })

    expect(() => requireHostDependencies(directory, { resolve: () => '/usr/bin/docker' }))
      .toThrow(/invalid declaration\(s\): null/)
  })
})
