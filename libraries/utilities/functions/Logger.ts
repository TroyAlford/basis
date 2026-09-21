/* eslint-disable no-console */
import chalk from 'chalk'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LOG_COLORS } from '../constants/LogColors'

/** Interface for basic logging functionality. */
export interface ILogger {
  /**
   * Logs an error message.
   * @param messages - Messages to log at error level.
   */
  error: Console['error'],

  /**
   * Logs an info message.
   * @param messages - Messages to log at info level.
   */
  info: Console['info'],

  /**
   * Checks the current duration of a running stopwatch.
   * @param stopwatch - Stopwatch identifier to check.
   * @param description - Optional description to include in the log.
   * @returns Current duration in milliseconds, or `NaN` if the stopwatch is not found.
   */
  stopwatchSplit: (stopwatch: symbol, description?: string) => number,

  /**
   * Starts a new stopwatch.
   * @param description - Optional description to log when starting.
   * @returns Symbol identifier for the stopwatch.
   */
  stopwatchStart: (description?: string) => symbol,

  /**
   * Stops a stopwatch and optionally logs the duration.
   * @param stopwatch - Stopwatch identifier to stop.
   * @param description - Optional description to include in the log.
   * @returns Duration in milliseconds, or `NaN` if the stopwatch is not found.
   */
  stopwatchStop: (stopwatch: symbol, description?: string) => number,

  /**
   * Logs a warning message.
   * @param messages - Messages to log at warning level.
   */
  warn: Console['warn'],
}

/** Logger configuration options. */
export interface LoggerOptions {
  /**
   * When set, each log line is also appended to this UTF-8 file (the same content as the console
   * line, including any ANSI escapes emitted by chalk and callers). The parent directory is created
   * when missing.
   */
  logFilePath?: string,
  /**
   * When set alongside `logFilePath`, the file is trimmed to at most this many lines (keeping the
   * newest) once it grows past the threshold. Trimming is asynchronous and non-blocking.
   * Recommended: `5000`.
   */
  maxLogLines?: number,
  /** Prefix to prepend to all log messages. */
  prefix?: string,
  /** Whether to suppress all log output. */
  silent?: boolean,
}

/** Log message severity levels. */
enum Severity {
  Error = 'ERROR',
  Info = 'INFO',
  Warn = 'WARN',
}

/** Styled header formats for different severity levels. */
const HEADERS = {
  ERROR: chalk.bgRed(chalk.black(' ERROR ')),
  INFO: chalk.hex(LOG_COLORS.info)('INFO'),
  WARN: chalk.bgYellow(chalk.black(' WARN ')),
}

/** Timer tracking information. */
interface Stopwatch {
  /** Start time of the timer. */
  startTime: number,
}

/**
 * Logger implementation with timestamp and severity formatting.
 *
 * Supports an optional message prefix, silent mode, an optional bounded file sink, and stopwatch
 * helpers. The logger writes to the console; callers that need scoped output can derive a prefixed
 * view with {@link Logger.withPrefix}.
 */
export class Logger implements ILogger {
  /** Default configuration options for the logger. */
  static DEFAULT_OPTIONS: LoggerOptions = {
    prefix: '',
  }

  /** Number of lines appended since the last trim check. */
  private appendCount = 0
  /** Logger configuration options. */
  private options: LoggerOptions
  /** Active timers mapped by symbol. */
  private stopwatches = new Map<symbol, Stopwatch>()
  /** True while an async trim is in progress (prevents concurrent re-entry). */
  private trimPending = false

  /**
   * Creates a new Logger instance.
   * @param options - Logger configuration options.
   */
  constructor(options: LoggerOptions = {}) {
    this.options = { ...Logger.DEFAULT_OPTIONS, ...options }
  }

  /**
   * Current timestamp in `HH:MM:SS.mmm` format.
   * @returns The formatted timestamp.
   */
  get timestamp(): string {
    const now = new Date()
    const HMS = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => value.toString().padStart(2, '0'))
      .join(':')
    const MS = now.getMilliseconds().toString().padStart(3, '0')

    return `${HMS}.${MS}`
  }

  /**
   * Formats a duration in milliseconds to a human-readable string.
   * @param ms - Duration in milliseconds.
   * @returns Formatted duration string.
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`
    }

    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(2)}s`

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = (seconds % 60).toFixed(1)
    return `${minutes}m ${remainingSeconds}s`
  }

  /**
   * Internal logging implementation.
   * @param severity - Log message severity level.
   * @param messages - Messages to log.
   */
  private log(severity: Severity, ...messages: string[]): void {
    if (this.options.silent) return
    const parts = [
      this.options.prefix,
      chalk.hex(LOG_COLORS.yellow)(this.timestamp),
      HEADERS[severity],
      ...messages,
    ].filter(Boolean)
    console.log(...parts)

    const { logFilePath, maxLogLines } = this.options
    if (!logFilePath) return

    const line = parts.join(' ').trim()
    try {
      mkdirSync(dirname(logFilePath), { recursive: true })
      appendFileSync(logFilePath, `${line}\n`, 'utf8')
      if (maxLogLines && (++this.appendCount % 100 === 0)) {
        void this.trimLogFile(logFilePath, maxLogLines)
      }
    } catch {
      // Avoid throwing from logging
    }
  }

  /**
   * Trims the log file to the newest `maxLogLines` lines. Fire-and-forget; failures are swallowed.
   * @param path - Absolute path to the log file.
   * @param maxLogLines - Maximum number of lines to retain.
   */
  private async trimLogFile(path: string, maxLogLines: number): Promise<void> {
    if (this.trimPending) return
    this.trimPending = true

    try {
      const content = await readFile(path, 'utf8')
      const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
      if (lines.length <= maxLogLines) return
      await writeFile(path, `${lines.slice(-maxLogLines).join('\n')}\n`, 'utf8')
    } catch {
      // Trim failures are non-fatal
    } finally {
      this.trimPending = false
    }
  }

  /**
   * Logs an error message.
   * @param messages - Messages to log at error level.
   */
  error = (...messages: string[]): void => { this.log(Severity.Error, ...messages) }

  /**
   * Logs an info message.
   * @param messages - Messages to log at info level.
   */
  info = (...messages: string[]): void => { this.log(Severity.Info, ...messages) }

  /**
   * Logs a warning message.
   * @param messages - Messages to log at warning level.
   */
  warn = (...messages: string[]): void => { this.log(Severity.Warn, ...messages) }

  /**
   * Returns an `ILogger` that prepends `prefix` to every message, writing to the same underlying
   * log.
   * @param prefix - The prefix label to prepend.
   * @returns A prefixed `ILogger` view of this logger.
   */
  withPrefix(prefix: string): ILogger {
    return {
      error: (...messages: string[]) => this.error(prefix, ...messages),
      info: (...messages: string[]) => this.info(prefix, ...messages),
      stopwatchSplit: (stopwatch, description) => this.stopwatchSplit(stopwatch, description),
      stopwatchStart: description => this.stopwatchStart(description),
      stopwatchStop: (stopwatch, description) => this.stopwatchStop(stopwatch, description),
      warn: (...messages: string[]) => this.warn(prefix, ...messages),
    }
  }

  /**
   * Checks the current duration of a running stopwatch.
   * @param stopwatch - Stopwatch identifier to check.
   * @param description - Optional description to include in the log.
   * @returns Current duration in milliseconds, or `NaN` if the stopwatch is not found.
   */
  stopwatchSplit(stopwatch: symbol, description?: string): number {
    const stopwatchData = this.stopwatches.get(stopwatch)
    if (!stopwatchData) {
      this.warn('Stopwatch not found')
      return NaN
    }

    const duration = performance.now() - stopwatchData.startTime

    if (description) {
      const formatted = this.formatDuration(duration)
      this.info(`⏱️ [${formatted}]: ${description}`)
    }

    return duration
  }

  /**
   * Starts a new stopwatch.
   * @param description - Optional description to log when starting.
   * @returns Symbol identifier for the stopwatch.
   */
  stopwatchStart(description?: string): symbol {
    const stopwatch = Symbol('stopwatch')
    this.stopwatches.set(stopwatch, { startTime: performance.now() })

    if (description) this.info(`⏱️ [—]: ${description}`)

    return stopwatch
  }

  /**
   * Stops a stopwatch and optionally logs the duration.
   * @param stopwatch - Stopwatch identifier to stop.
   * @param description - Optional description to include in the log.
   * @returns Duration in milliseconds, or `NaN` if the stopwatch is not found.
   */
  stopwatchStop(stopwatch: symbol, description?: string): number {
    const stopwatchData = this.stopwatches.get(stopwatch)
    if (!stopwatchData) {
      this.warn('Stopwatch not found')
      return NaN
    }

    const duration = performance.now() - stopwatchData.startTime
    this.stopwatches.delete(stopwatch)

    if (description) {
      const formatted = this.formatDuration(duration)
      this.info(`⏱️ [${formatted}]: ${description}`)
    }

    return duration
  }
}
