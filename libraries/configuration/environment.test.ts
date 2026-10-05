import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Environment, loadDotenv } from './environment'

/** Environment keys used by the tests. */
const A = 'BASIS_CONFIG_A'
const N = 'BASIS_CONFIG_N'
const F = 'BASIS_CONFIG_F'
const E = 'BASIS_CONFIG_E'

/** Temporary directories to remove after each test. */
const directories: string[] = []

/**
 * Write a fixture directory holding the named dotenv files.
 * @param files - Map of filename to contents.
 * @returns The fixture directory.
 */
function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'basis-configuration-'))
  directories.push(directory)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  return directory
}

/**
 * Run `body` with environment variables temporarily set or removed.
 * @param overrides - Variables to set, or `undefined` to remove.
 * @param body - The assertions to run.
 */
function withEnv(overrides: Record<string, string | undefined>, body: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(overrides)) previous.set(key, Bun.env[key])
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(Bun.env, key)
    else Bun.env[key] = value
  }

  try {
    body()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(Bun.env, key)
      else Bun.env[key] = value
    }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('loadDotenv', () => {
  test('loads the most specific file first', () => {
    const directory = fixture({
      '.env': `${A}=base`,
      '.env.development': `${A}=mode`,
      '.env.development.local': `${A}=specific`,
      '.env.local': `${A}=local`,
    })

    withEnv({ [A]: undefined }, () => {
      loadDotenv({ directory, mode: 'development' })
      expect(Bun.env[A]).toBe('specific')
    })
  })

  test('never overrides a variable already present in the process environment', () => {
    const directory = fixture({ '.env': `${A}=base` })

    withEnv({ [A]: 'process' }, () => {
      loadDotenv({ directory, mode: 'development' })
      expect(Bun.env[A]).toBe('process')
    })
  })

  test('mode defaults to NODE_ENV', () => {
    const directory = fixture({ '.env.production': `${A}=prod` })

    withEnv({ [A]: undefined, NODE_ENV: 'production' }, () => {
      loadDotenv({ directory })
      expect(Bun.env[A]).toBe('prod')
    })
  })
})

describe('Environment', () => {
  test('reads a string, trimming and treating blank as unset', () => {
    withEnv({ [A]: '  spaced  ' }, () => {
      expect(new Environment().string(A)).toBe('spaced')
    })
    withEnv({ [A]: '   ' }, () => {
      expect(new Environment().string(A, 'fallback')).toBe('fallback')
    })
  })

  test('parses a finite number, falls back when unset, and fails loud when malformed', () => {
    const environment = new Environment()
    withEnv({ [N]: '3.5' }, () => expect(environment.number(N)).toBe(3.5))
    withEnv({ [N]: undefined }, () => expect(environment.number(N, 7)).toBe(7))
    withEnv({ [N]: 'garbage' }, () => expect(() => environment.number(N)).toThrow(N))
  })

  test('parses boolean tokens, falls back when unset, and fails loud when malformed', () => {
    const environment = new Environment()
    withEnv({ [F]: 'yes' }, () => expect(environment.boolean(F)).toBe(true))
    withEnv({ [F]: 'off' }, () => expect(environment.boolean(F)).toBe(false))
    withEnv({ [F]: undefined }, () => expect(environment.boolean(F, true)).toBe(true))
    withEnv({ [F]: 'maybe' }, () => expect(() => environment.boolean(F)).toThrow(F))
  })

  test('required fails loudly naming the missing key', () => {
    withEnv({ [E]: undefined }, () => {
      expect(() => new Environment().required(E)).toThrow(E)
    })
  })

  test('enabled computes presence across the named keys', () => {
    withEnv({ [A]: 'set', [E]: undefined }, () => {
      const environment = new Environment()
      expect(environment.enabled(A)).toBe(true)
      expect(environment.enabled(A, E)).toBe(false)
      expect(environment.enabled()).toBe(true)
    })
  })
})
