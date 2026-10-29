import { describe, expect, test } from 'bun:test'
import { Logger } from '../utilities'
import { run, runAsync } from './run'

/** A logger that stays quiet in tests. */
const silent = new Logger({ silent: true })

describe('run', () => {
  test('captures stdout and a zero exit', () => {
    const result = run('printf', ['hello'], { logger: silent })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
  })

  test('captures a non-zero exit and stderr', () => {
    const result = run('cat', ['/definitely-not-a-real-path'], { logger: silent })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('/definitely-not-a-real-path')
  })

  test('overlays extra environment on the current one', () => {
    const result = run('printenv', ['BASIS_RUN_TEST'], {
      env: { BASIS_RUN_TEST: 'value' },
      logger: silent,
    })

    expect(result.stdout.trim()).toBe('value')
  })

  test('runs in the requested working directory', () => {
    const result = run('pwd', [], { cwd: '/', logger: silent })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('/')
  })

  test('bounds a command with a timeout', () => {
    const result = run('sleep', ['5'], { logger: silent, timeoutMs: 100 })

    expect(result.exitCode).not.toBe(0)
  })

  test('normalizes stdout into lines without a trailing empty line', () => {
    expect(run('printf', ['one\\ntwo\\n'], { logger: silent }).lines).toEqual(['one', 'two'])
    expect(run('printf', [''], { logger: silent }).lines).toEqual([])
  })

  test('runs a tagged template with interpolations as discrete arguments', () => {
    const value = 'hello world'
    const result = run`printf %s ${value}`

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(value)
  })
})

describe('runAsync', () => {
  test('captures stdout, stderr, and a zero exit', async () => {
    const result = await runAsync('printf', ['hello'], { logger: silent })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.lines).toEqual(['hello'])
  })

  test('captures a non-zero exit and stderr', async () => {
    const result = await runAsync('cat', ['/definitely-not-a-real-path'], { logger: silent })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('/definitely-not-a-real-path')
  })

  test('overlays extra environment on the current one', async () => {
    const result = await runAsync('printenv', ['BASIS_RUN_TEST'], {
      env: { BASIS_RUN_TEST: 'value' },
      logger: silent,
    })

    expect(result.stdout.trim()).toBe('value')
  })

  test('bounds a command with a timeout', async () => {
    const result = await runAsync('sleep', ['5'], { logger: silent, timeoutMs: 100 })

    expect(result.exitCode).not.toBe(0)
  })

  test('runs a tagged template with interpolations as discrete arguments', async () => {
    const value = 'hello world'
    const result = await runAsync`printf %s ${value}`

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(value)
  })
})
