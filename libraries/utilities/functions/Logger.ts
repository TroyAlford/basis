/* eslint-disable no-console */
import type { ChalkInstance } from 'chalk'
import { Chalk } from 'chalk'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LOG_COLORS } from '../constants/LogColors'

/**
 * Automatic runtime context attached to every log record.
 *
 * The platform supplies these values as the environment variables
 * `SERVICE_NAME`, `VERSION`, and `GIT_SHA`. They are read automatically when
 * present so an application gets identified logs without any per-app setup;
 * explicit values passed to the logger take precedence.
 */
export interface LoggerContext {
  /** Observed deployed checkout revision (`GIT_SHA`). */
  gitSha?: string,
  /** Service identity, conventionally the repository name (`SERVICE_NAME`). */
  service?: string,
  /** Authoritative release version (`VERSION`). */
  version?: string,
}

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
   * @returns Current duration in milliseconds, or `NaN` if the stopwatch is not found.
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
   * Whether to emit ANSI color. Defaults to `true` whenever the conventional
   * `NO_COLOR` opt-out is not set, so color survives non-interactive sinks such
   * as PM2's log files (command-center renders their ANSI styling). Set `false`
   * to force plain output, or leave unset to respect `NO_COLOR`/`FORCE_COLOR`.
   */
  colors?: boolean,
  /**
   * Runtime context attached to every record. Values not supplied here fall
   * back to the platform environment (`SERVICE_NAME`, `VERSION`, `GIT_SHA`).
   */
  context?: LoggerContext,
  /**
   * When set, each log line is also appended to this UTF-8 file (the same content as the console
   * line, including any ANSI escapes emitted by chalk and callers). The parent directory is created
   * when missing.
   */
  logFilePath?: string,
  /**
   * When set alongside `logFilePath`, the file is trimmed to at most this many lines (keeping the
   * newest) once it grows past the threshold. Trimming is synchronous and bounded, so it cannot
   * overwrite lines appended after the trim begins. Recommended: `5000`.
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

/** Timer tracking information. */
interface Stopwatch {
  /** Start time of the timer. */
  startTime: number,
}

/**
 * Resolve the ANSI color level for a logger.
 *
 * `NO_COLOR` always wins, per the conventional opt-out. Otherwise color stays
 * available: an interactive terminal keeps chalk's detected depth, while a
 * non-interactive sink (a pipe, a file, or PM2) gets basic 16-color output
 * rather than none, because those logs are rendered by command-center.
 * @returns The color support level (`0` disables color).
 */
function resolveColorLevel(): 0 | 1 | 2 | 3 {
  const env = typeof Bun === 'undefined' ? process.env : Bun.env
  const noColor = env.NO_COLOR
  if (typeof noColor === 'string' && noColor.length > 0) return 0

  const force = env.FORCE_COLOR
  if (typeof force === 'string') {
    if (force === '0' || force === 'false') return 0
    const level = Number(force)
    if (Number.isInteger(level) && level >= 0 && level <= 3) return level as 0 | 1 | 2 | 3
    return 1
  }

  const interactive = typeof process.stdout?.isTTY === 'boolean' && process.stdout.isTTY
  if (interactive) {
    // The default instance has already detected the terminal's depth.
    const detected = new Chalk().level
    return detected > 0 ? detected : 1
  }
  // Keep color available under PM2 and other non-interactive sinks.
  return 1
}

/**
 * Read the platform runtime context from the environment.
 * @returns The context fields the environment provides.
 */
function contextFromEnvironment(): LoggerContext {
  const env = typeof Bun === 'undefined' ? process.env : Bun.env
  const context: LoggerContext = {}
  if (typeof env.SERVICE_NAME === 'string' && env.SERVICE_NAME.length > 0) context.service = env.SERVICE_NAME
  if (typeof env.VERSION === 'string' && env.VERSION.length > 0) context.version = env.VERSION
  if (typeof env.GIT_SHA === 'string' && env.GIT_SHA.length > 0) context.gitSha = env.GIT_SHA
  return context
}

/**
 * Logger implementation with a UTC ISO-8601 timestamp, severity, and automatic
 * service context.
 *
 * Supports an optional message prefix, silent mode, an optional bounded file
 * sink, and stopwatch helpers. The logger writes to the console; callers that
 * need scoped output can derive a prefixed view with {@link Logger.withPrefix}.
 */
export class Logger implements ILogger {
  /** Default configuration options for the logger. */
  static DEFAULT_OPTIONS: LoggerOptions = {
    prefix: '',
  }

  /** Number of lines appended since the last trim check. */
  private appendCount = 0
  /** Resolved runtime context attached to every record. */
  private readonly context: LoggerContext
  /** Palette configured for the resolved color level. */
  private readonly palette: ChalkInstance
  /** Logger configuration options. */
  private options: LoggerOptions
  /** Active timers mapped by symbol. */
  private stopwatches = new Map<symbol, Stopwatch>()
  /** Severity headers styled for the resolved color level. */
  private readonly headers: Record<Severity, string>

  /**
   * Creates a new Logger instance.
   * @param options - Logger configuration options.
   */
  constructor(options: LoggerOptions = {}) {
    this.options = { ...Logger.DEFAULT_OPTIONS, ...options }
    this.context = { ...contextFromEnvironment(), ...options.context }

    const level = options.colors === true
      ? (resolveColorLevel() || 1)
      : options.colors === false ? 0 : resolveColorLevel()
    this.palette = new Chalk({ level })
    this.headers = {
      [Severity.Error]: this.palette.bgRed(this.palette.black(' ERROR ')),
      [Severity.Info]: this.palette.hex(LOG_COLORS.info)('INFO'),
      [Severity.Warn]: this.palette.bgYellow(this.palette.black(' WARN ')),
    }
  }

  /**
   * Current timestamp as a UTC ISO-8601 instant, including date and timezone
   * (for example `2026-09-24T12:34:56.789Z`).
   * @returns The formatted timestamp.
   */
  get timestamp(): string {
    return new Date().toISOString()
  }

  /**
   * Render the service context segment for a record.
   * @returns The bracketed context, or an empty string when no context is set.
   */
  private formatContext(): string {
    const tokens = [this.context.service, this.context.version, this.context.gitSha]
      .filter((token): token is string => typeof token === 'string' && token.length > 0)
    if (tokens.length === 0) return ''
    return this.palette.gray(`[${tokens.join(' ')}]`)
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
      this.palette.hex(LOG_COLORS.yellow)(this.timestamp),
      this.headers[severity],
      this.formatContext(),
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
        this.trimLogFile(logFilePath, maxLogLines)
      }
    } catch {
      // Avoid throwing from logging
    }
  }

  /**
   * Trims the log file to the newest `maxLogLines` lines.
   *
   * This runs synchronously and completes within the append that triggers it, so no append can
   * interleave between reading the snapshot and replacing the file. Failures are swallowed so
   * logging never throws.
   * @param path - Absolute path to the log file.
   * @param maxLogLines - Maximum number of lines to retain.
   */
  private trimLogFile(path: string, maxLogLines: number): void {
    try {
      const content = readFileSync(path, 'utf8')
      const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
      if (lines.length <= maxLogLines) return
      writeFileSync(path, `${lines.slice(-maxLogLines).join('\n')}\n`, 'utf8')
    } catch {
      // Trim failures are non-fatal
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
   * @param messages - Messages to log at warn level.
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
   * @returns Current duration in milliseconds, or `NaN` if the stopwatch is not found.
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
