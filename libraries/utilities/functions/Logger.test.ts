import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { Logger } from './Logger'

/**
 * Removes ANSI escape sequences so assertions do not depend on the terminal's color support.
 * @param value - The text to normalize.
 * @returns The text without ANSI escape sequences.
 */
const stripAnsi = (value: string): string => stripVTControlCharacters(value)

/**
 * Counts the lines currently written to a file.
 * @param path - Absolute path to the file to inspect.
 * @returns The number of lines in the file, treating a trailing newline as a terminator.
 */
const countLines = (path: string): number => {
  const content = readFileSync(path, 'utf8').trimEnd()
  return content.length === 0 ? 0 : content.split('\n').length
}

/**
 * Polls `predicate` until it returns true or `timeout` elapses.
 * @param predicate - Condition to wait for.
 * @param timeout - Maximum number of milliseconds to wait.
 */
const waitFor = async (predicate: () => boolean, timeout: number): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if ((Date.now() - start) > timeout) throw new Error('Timed out waiting for condition')
    await Bun.sleep(10)
  }
}

describe('Logger', () => {
  let captures: string[][]
  let restoreLog: () => void

  /**
   * Captures console output so tests can assert on the formatted lines.
   * @returns The captured output as a single normalized string.
   */
  const output = (): string => stripAnsi(captures.map(line => line.join(' ')).join('\n'))

  beforeEach(() => {
    captures = []
    const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captures.push(args.map(String))
    })
    restoreLog = () => spy.mockRestore()
  })

  afterEach(() => {
    restoreLog()
  })

  test('exposes default options', () => {
    expect(Logger.DEFAULT_OPTIONS).toEqual({ prefix: '' })
  })

  test('logs info, warn, and error with severity headers', () => {
    const logger = new Logger()

    logger.info('hello')
    logger.warn('careful')
    logger.error('boom')

    expect(output()).toContain('INFO')
    expect(output()).toContain('hello')
    expect(output()).toContain('WARN')
    expect(output()).toContain('careful')
    expect(output()).toContain('ERROR')
    expect(output()).toContain('boom')
  })

  test('prepends the configured prefix', () => {
    const logger = new Logger({ prefix: '[app]' })

    logger.info('hello')

    expect(output()).toContain('[app]')
    expect(output()).toContain('hello')
  })

  test('silences all output', () => {
    const logger = new Logger({ silent: true })

    logger.info('nope')
    logger.warn('nope')
    logger.error('nope')

    expect(captures).toHaveLength(0)
  })

  test('derives prefixed logger views', () => {
    const logger = new Logger()
    const scoped = logger.withPrefix('[db]')

    scoped.info('connected')

    expect(output()).toContain('[db]')
    expect(output()).toContain('connected')
  })

  test('measures and forgets stopwatches', () => {
    const logger = new Logger({ silent: true })
    const stopwatch = logger.stopwatchStart()

    expect(logger.stopwatchSplit(stopwatch)).toBeGreaterThanOrEqual(0)
    expect(logger.stopwatchStop(stopwatch)).toBeGreaterThanOrEqual(0)
    expect(logger.stopwatchStop(stopwatch)).toBeNaN()
  })

  test('writes to the configured log file, creating parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-logger-'))
    const path = join(dir, 'nested', 'app.log')

    try {
      const logger = new Logger({ logFilePath: path })

      logger.info('persisted')

      expect(stripAnsi(readFileSync(path, 'utf8'))).toContain('persisted')
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('trims the log file to maxLogLines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'basis-logger-'))
    const path = join(dir, 'app.log')

    try {
      const logger = new Logger({ logFilePath: path, maxLogLines: 10 })

      for (let index = 0; index < 100; index += 1) logger.info(`line-${index}`)

      await waitFor(() => countLines(path) <= 10, 2000)

      const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
      expect(lines).toHaveLength(10)
      expect(stripAnsi(lines[lines.length - 1])).toContain('line-99')
      expect(stripAnsi(lines[0])).toContain('line-90')
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
