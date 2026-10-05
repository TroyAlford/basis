import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostProbe } from './host-dependencies'
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

/**
 * Build a probe that records calls and returns a scripted exit code per command.
 * @param exitCodes - Exit code by command name; an unlisted command exits zero.
 * @returns The prober and its recorded calls.
 */
function fakeProbe(exitCodes: Record<string, number> = {}) {
  const calls: { readonly args: readonly string[], readonly command: string }[] = []
  const probe: HostProbe = (command, args) => {
    calls.push({ args, command })
    return { exitCode: exitCodes[command] ?? 0 }
  }
  return { calls, probe }
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
  test('probes known capabilities with their version command', () => {
    const { calls, probe } = fakeProbe()
    const check = checkHostDependencies(['docker', 'nginx', 'opencode'], {
      probe,
      resolve: () => '/usr/bin/x',
    })

    expect(check.resolved).toEqual(['docker', 'nginx', 'opencode'])
    expect(calls).toEqual([
      { args: ['--version'], command: 'docker' },
      { args: ['-v'], command: 'nginx' },
      { args: ['--version'], command: 'opencode' },
    ])
  })

  test('reports a present but not runnable capability as broken', () => {
    const { probe } = fakeProbe({ nginx: 1 })
    const check = checkHostDependencies(['nginx'], { probe, resolve: () => '/usr/sbin/nginx' })

    expect(check.broken).toEqual(['nginx'])
    expect(check.resolved).toEqual([])
    expect(check.missing).toEqual([])
  })

  test('does not probe a capability that is not on PATH', () => {
    const { calls, probe } = fakeProbe()
    const check = checkHostDependencies(['docker'], { probe, resolve: () => null })

    expect(check.missing).toEqual(['docker'])
    expect(calls).toEqual([])
  })

  test('leaves unknown capabilities to PATH presence without probing', () => {
    const { calls, probe } = fakeProbe()
    const check = checkHostDependencies(['some-tool'], { probe, resolve: () => '/usr/bin/some-tool' })

    expect(check.resolved).toEqual(['some-tool'])
    expect(calls).toEqual([])
  })

  test('splits invalid declarations from valid ones', () => {
    const check = checkHostDependencies(['', 42, null], { resolve: () => null })

    expect(check.invalid).toEqual(['""', '42', 'null'])
  })
})

describe('requireHostDependencies', () => {
  test('returns the resolved capabilities when every declaration is satisfied', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'some-tool'] }, name: 'app' })
    const check = requireHostDependencies(directory, {
      probe: () => ({ exitCode: 0 }),
      resolve: () => '/usr/bin/x',
    })

    expect(check.resolved).toEqual(['docker', 'some-tool'])
  })

  test('fails loudly naming every missing capability', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'op', 'lego'] }, name: 'app' })
    const resolve = (command: string): string | null => (command === 'docker' ? '/usr/bin/docker' : null)

    expect(() => requireHostDependencies(directory, { probe: () => ({ exitCode: 0 }), resolve }))
      .toThrow(/not found on PATH: op, lego/)
  })

  test('fails loudly naming every present but broken capability', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', 'op'] }, name: 'app' })
    const probe = (command: string): { exitCode: number } => ({ exitCode: command === 'op' ? 1 : 0 })

    expect(() => requireHostDependencies(directory, { probe, resolve: () => '/usr/bin/x' }))
      .toThrow(/present but not runnable: op/)
  })

  test('fails loudly naming every malformed declaration', () => {
    const directory = fixture({ basis: { hostDependencies: ['docker', null] }, name: 'app' })

    expect(() => requireHostDependencies(directory, {
      probe: () => ({ exitCode: 0 }),
      resolve: () => '/usr/bin/docker',
    })).toThrow(/invalid declaration\(s\): null/)
  })
})
