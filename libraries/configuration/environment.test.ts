import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfiguration, Environment, environmentFiles, loadEnvironment } from './environment'

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

describe('environmentFiles', () => {
  test('returns the standard precedence order', () => {
    expect(environmentFiles('development')).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ])
  })
})

describe('loadEnvironment', () => {
  test('loads the most specific file first', () => {
    const directory = fixture({
      '.env': `${A}=base`,
      '.env.development': `${A}=mode`,
      '.env.development.local': `${A}=specific`,
      '.env.local': `${A}=local`,
    })

    withEnv({ [A]: undefined }, () => {
      const loaded = loadEnvironment({ directory, mode: 'development' })

      expect(loaded).toEqual([
        join(directory, '.env.development.local'),
        join(directory, '.env.local'),
        join(directory, '.env.development'),
        join(directory, '.env'),
      ])
      expect(Bun.env[A]).toBe('specific')
    })
  })

  test('never overrides a variable already present in the process environment', () => {
    const directory = fixture({ '.env': `${A}=base` })

    withEnv({ [A]: 'process' }, () => {
      loadEnvironment({ directory, mode: 'development' })

      expect(Bun.env[A]).toBe('process')
    })
  })

  test('skips absent files', () => {
    const directory = fixture({ '.env': `${A}=base` })

    withEnv({ [A]: undefined }, () => {
      expect(loadEnvironment({ directory, mode: 'development' })).toEqual([join(directory, '.env')])
    })
  })

  test('mode defaults to NODE_ENV and then development', () => {
    const directory = fixture({ '.env.development': `${A}=dev` })

    withEnv({ [A]: undefined, NODE_ENV: undefined }, () => {
      loadEnvironment({ directory })
      expect(Bun.env[A]).toBe('dev')
    })
  })
})

describe('Environment', () => {
  test('trims values and treats blank as unset', () => {
    withEnv({ [A]: '  spaced  ' }, () => {
      expect(new Environment().value(A)).toBe('spaced')
    })
    withEnv({ [A]: '   ' }, () => {
      expect(new Environment().value(A)).toBeUndefined()
    })
  })

  test('parses finite numbers and falls back otherwise', () => {
    const environment = new Environment()
    withEnv({ [N]: '3.5' }, () => {
      expect(environment.number(N, 7)).toBe(3.5)
    })
    withEnv({ [N]: 'not-a-number' }, () => {
      expect(environment.number(N, 7)).toBe(7)
    })
    withEnv({ [N]: undefined }, () => {
      expect(environment.number(N)).toBeUndefined()
    })
  })

  test('parses boolean tokens and falls back otherwise', () => {
    const environment = new Environment()
    withEnv({ [F]: 'yes' }, () => expect(environment.boolean(F)).toBe(true))
    withEnv({ [F]: 'off' }, () => expect(environment.boolean(F)).toBe(false))
    withEnv({ [F]: 'maybe' }, () => expect(environment.boolean(F, true)).toBe(true))
    withEnv({ [F]: undefined }, () => expect(environment.boolean(F, true)).toBe(true))
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

  test('derives mode flags from NODE_ENV', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      const environment = new Environment()
      expect(environment.mode).toBe('production')
      expect(environment.production).toBe(true)
      expect(environment.development).toBe(false)
    })
    withEnv({ NODE_ENV: 'development' }, () => {
      const environment = new Environment()
      expect(environment.mode).toBe('development')
      expect(environment.development).toBe(true)
    })
  })
})

describe('createConfiguration', () => {
  test('groups typed getters by topic with computed ENABLED flags', () => {
    const directory = fixture({})

    withEnv({ [A]: 'token', [E]: undefined }, () => {
      const configuration = createConfiguration({
        ONE_PASSWORD: env => ({ get ENABLED(): boolean { return env.enabled(A) } }),
        RUNTIME: env => ({ get DEVELOPMENT(): boolean { return env.development } }),
      }, { directory, mode: 'development' })

      expect(configuration.ONE_PASSWORD.ENABLED).toBe(true)
      expect(configuration.RUNTIME.DEVELOPMENT).toBe(true)
    })
  })
})
