import { describe, expect, test } from 'bun:test'
import type { CommandResult, RunOptions } from './run'
import { createSecretReader, secret, SecretReadError } from './secret'

const TOKEN = 'ops_preview_token_value'

/**
 * Run `body` with an environment variable temporarily set or removed.
 * @param key - Variable name.
 * @param value - Value to set, or `undefined` to remove it.
 * @param body - The assertions to run.
 */
function withEnv(key: string, value: string | undefined, body: () => void): void {
  const previous = Bun.env[key]

  if (value === undefined) Reflect.deleteProperty(Bun.env, key)
  else Bun.env[key] = value

  try {
    body()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(Bun.env, key)
    else Bun.env[key] = previous
  }
}

/**
 * Build a fake synchronous runner that records calls and returns scripted results.
 * @param handler - Maps args to a partial command result.
 * @returns The runner and its recorded calls.
 */
function fakeRunner(handler: (args: readonly string[]) => Partial<CommandResult> = () => ({})) {
  const calls: { readonly args: readonly string[], readonly options?: RunOptions }[] = []
  const runner = (_command: string, args: readonly string[], options?: RunOptions): CommandResult => {
    calls.push({ args: [...args], ...(options === undefined ? {} : { options }) })
    return { exitCode: 0, stderr: '', stdout: '', ...handler(args) }
  }
  return { calls, runner }
}

describe('createSecretReader', () => {
  test('returns the value as a string, with the reference as the only argument', () => {
    const { calls, runner } = fakeRunner(() => ({ stdout: 'plain-secret-value\n' }))
    const reader = createSecretReader({ runner, token: TOKEN })

    expect(reader.secret('op://Vault/item/field')).toBe('plain-secret-value')
    expect(calls[0]?.args).toEqual(['read', 'op://Vault/item/field'])
    // The reference is the only argument; no value ever becomes an argument.
    expect(calls[0]?.args.join(' ')).not.toContain('plain-secret-value')
  })

  test('returns raw strings and never parses their shape', () => {
    const { runner } = fakeRunner(args => {
      const reference = args[1]
      if (reference === 'op://V/i/number') return { stdout: '42\n' }
      if (reference === 'op://V/i/boolean') return { stdout: 'true' }
      if (reference === 'op://V/i/json') return { stdout: '{"a":1}\n' }
      return { stdout: 'unused' }
    })
    const reader = createSecretReader({ runner, token: TOKEN })

    expect(reader.secret('op://V/i/number')).toBe('42')
    expect(reader.secret('op://V/i/boolean')).toBe('true')
    expect(reader.secret('op://V/i/json')).toBe('{"a":1}')
  })

  test('sets the variable op actually reads on the child', () => {
    const { calls, runner } = fakeRunner(() => ({ stdout: 'x\n' }))
    createSecretReader({ runner, token: TOKEN }).secret('op://V/item/field')

    const env = calls[0]?.options?.env
    expect(env?.OP_SERVICE_ACCOUNT_TOKEN).toBe(TOKEN)
    // The token is not duplicated under a second name.
    expect(env?.CC_ONEPASSWORD_ACCOUNT_TOKEN).toBeUndefined()
  })

  test('invokes the configured executable by default as `op`', () => {
    const commands: string[] = []
    const runner = (command: string): CommandResult => {
      commands.push(command)
      return { exitCode: 0, stderr: '', stdout: 'x' }
    }

    createSecretReader({ runner, token: TOKEN }).secret('op://V/i/f')
    expect(commands).toEqual(['op'])
  })

  test('fails closed without a token, before any subprocess runs', () => {
    const { calls, runner } = fakeRunner()
    expect(() => createSecretReader({ runner, token: null }).secret('op://V/a/b'))
      .toThrow(SecretReadError)
    expect(calls).toHaveLength(0)
  })

  test('names the reference but never the value or token on failure', () => {
    const { runner } = fakeRunner(() => ({
      exitCode: 1,
      stderr: 'the value is super-secret-value',
      stdout: 'super-secret-value\n',
    }))
    try {
      createSecretReader({ runner, token: TOKEN }).secret('op://V/a/secret-value-field')
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(SecretReadError)
      expect((error as Error).message).toContain('op://V/a/secret-value-field')
      expect((error as Error).message).not.toContain('super-secret-value')
      expect((error as Error).message).not.toContain(TOKEN)
    }
  })
})

describe('secret', () => {
  test('fails closed when the ambient OP_SERVICE_ACCOUNT_TOKEN is unset', () => {
    withEnv('OP_SERVICE_ACCOUNT_TOKEN', undefined, () => {
      expect(() => secret('op://V/a/b')).toThrow(SecretReadError)
    })
  })
})
