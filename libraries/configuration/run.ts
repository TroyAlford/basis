/**
 * Synchronous subprocess execution for one-shot scripts.
 *
 * Long-lived processes belong to an application's own supervisor; install,
 * bootstrap, and configuration scripts need a smaller, synchronous helper that
 * captures output, never goes through a shell, and reports itself through a
 * Basis {@link Logger} instead of scattered raw console writes. This is the
 * single bounded runner the first-party ecosystem shares, so applications stop
 * reimplementing it.
 */

import type { ILogger } from '../utilities'
import { Logger } from '../utilities'

/** Logger used when a caller does not supply one. */
const defaultLogger: ILogger = new Logger({ prefix: 'run' })

/** Captured result of a subprocess. */
export interface CommandResult {
  /** Process exit code. */
  readonly exitCode: number,
  /** Standard error. */
  readonly stderr: string,
  /** Standard output. */
  readonly stdout: string,
}

/** Options accepted by {@link run}. */
export interface RunOptions {
  /** Working directory. Defaults to the current process's. */
  readonly cwd?: string,
  /** Extra environment, overlaid on the current process environment. */
  readonly env?: Readonly<Record<string, string>>,
  /** Logger for the command line and any failure. Defaults to a `run`-prefixed logger. */
  readonly logger?: ILogger,
  /**
   * Kill the process after this many milliseconds. Omitted leaves the default
   * (no explicit bound). Used for bounded presence probes such as `--version`.
   */
  readonly timeoutMs?: number,
}

/**
 * Run a command synchronously with an explicit argv (never a shell string).
 * @param command - Executable to run.
 * @param args - Arguments.
 * @param options - Working directory, extra environment, timeout, and logger.
 * @returns The captured result.
 */
export function run(command: string, args: readonly string[] = [], options: RunOptions = {}): CommandResult {
  const logger = options.logger ?? defaultLogger
  const commandLine = [command, ...args].join(' ')

  logger.info(`$ ${commandLine}`)

  const result = Bun.spawnSync([command, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  })

  const captured: CommandResult = {
    exitCode: result.exitCode ?? 1,
    stderr: result.stderr?.toString() ?? '',
    stdout: result.stdout?.toString() ?? '',
  }

  if (captured.exitCode !== 0) {
    logger.error(`$ ${commandLine} exited ${captured.exitCode}: ${firstLine(captured.stderr) || 'no output'}`)
  }

  return captured
}

/**
 * The first non-empty line of command output, for a compact log message.
 * @param text - Captured output.
 * @returns The trimmed first line, or an empty string.
 */
function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}
