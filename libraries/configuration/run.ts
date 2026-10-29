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
  /** Normalized stdout lines: empty output is `[]`, with no trailing empty line. */
  readonly lines: readonly string[],
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
export function run(command: string, args?: readonly string[], options?: RunOptions): CommandResult
/**
 * Run a whitespace-tokenized command template synchronously.
 *
 * Interpolated values are single arguments; static text is split on
 * whitespace, so no shell quoting or expansion occurs.
 * @param strings - Static template segments.
 * @param values - Interpolated argument values.
 * @returns The captured result.
 */
export function run(strings: TemplateStringsArray, ...values: unknown[]): CommandResult
export function run(commandOrTemplate: string | TemplateStringsArray, ...rest: unknown[]): CommandResult {
  const { args, command, options } = invocation(commandOrTemplate, rest)
  const logger = options.logger ?? defaultLogger
  const commandLine = [command, ...args].join(' ')

  logger.info(`$ ${commandLine}`)

  const result = Bun.spawnSync([command, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env === undefined ? Bun.env : { ...Bun.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  })

  const stdout = result.stdout?.toString() ?? ''
  const captured: CommandResult = {
    exitCode: result.exitCode ?? 1,
    lines: normalizeLines(stdout),
    stderr: result.stderr?.toString() ?? '',
    stdout,
  }

  if (captured.exitCode !== 0) {
    logger.error(`$ ${commandLine} exited ${captured.exitCode}: ${firstLine(captured.stderr) || 'no output'}`)
  }

  return captured
}

/**
 * Run a command asynchronously with an explicit argv (never a shell string).
 * @param command - Executable to run.
 * @param args - Arguments.
 * @param options - Working directory, extra environment, timeout, and logger.
 * @returns The captured result.
 */
export async function runAsync(
  command: string,
  args?: readonly string[],
  options?: RunOptions,
): Promise<CommandResult>
/**
 * Run a whitespace-tokenized command template asynchronously.
 *
 * Interpolated values are single arguments; static text is split on
 * whitespace, so no shell quoting or expansion occurs.
 * @param strings - Static template segments.
 * @param values - Interpolated argument values.
 * @returns The captured result.
 */
export async function runAsync(strings: TemplateStringsArray, ...values: unknown[]): Promise<CommandResult>
export async function runAsync(
  commandOrTemplate: string | TemplateStringsArray,
  ...rest: unknown[]
): Promise<CommandResult> {
  const { args, command, options } = invocation(commandOrTemplate, rest)
  const logger = options.logger ?? defaultLogger
  const commandLine = [command, ...args].join(' ')

  logger.info(`$ ${commandLine}`)

  const child = Bun.spawn([command, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env === undefined ? Bun.env : { ...Bun.env, ...options.env },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const timer = options.timeoutMs === undefined
    ? null
    : setTimeout(() => child.kill(), options.timeoutMs)
  let exitCode: number
  let stderr: string
  let stdout: string
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
  const captured: CommandResult = {
    exitCode,
    lines: normalizeLines(stdout),
    stderr,
    stdout,
  }

  if (captured.exitCode !== 0) {
    logger.error(`$ ${commandLine} exited ${captured.exitCode}: ${firstLine(captured.stderr) || 'no output'}`)
  }

  return captured
}

/** A resolved command invocation. */
interface Invocation {
  /** Arguments after the executable. */
  args: string[],
  /** Executable to run. */
  command: string,
  /** Run options. */
  options: RunOptions,
}

/**
 * Resolve either the explicit-argv form or a tagged command template.
 * @param commandOrTemplate - Executable name or template strings.
 * @param rest - Arguments/options, or interpolated template values.
 * @returns The resolved invocation.
 */
function invocation(
  commandOrTemplate: string | TemplateStringsArray,
  rest: unknown[],
): Invocation {
  if (typeof commandOrTemplate === 'string') {
    const args = Array.isArray(rest[0]) ? rest[0] as string[] : []
    const options = rest[1] && typeof rest[1] === 'object' ? rest[1] as RunOptions : {}
    return { args, command: commandOrTemplate, options }
  }

  const tokens: string[] = []
  const append = (segment: string): void => {
    tokens.push(...segment.split(/\s+/).filter(Boolean))
  }

  append(commandOrTemplate[0] ?? '')
  for (let index = 0; index < rest.length; index += 1) {
    tokens.push(String(rest[index]))
    append(commandOrTemplate[index + 1] ?? '')
  }

  const [command, ...args] = tokens
  if (!command) throw new Error('Command template must start with an executable')
  return { args, command, options: {} }
}

/**
 * Normalize captured stdout into lines.
 * @param text - Captured stdout.
 * @returns The lines, with no trailing empty line.
 */
function normalizeLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n+$/g, '')
  return normalized === '' ? [] : normalized.split('\n')
}

/**
 * The first non-empty line of command output, for a compact log message.
 * @param text - Captured output.
 * @returns The trimmed first line, or an empty string.
 */
function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}
