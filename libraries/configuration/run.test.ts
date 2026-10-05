import { describe, expect, test } from 'bun:test'
import { Logger } from '../utilities'
import { run } from './run'

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
})
