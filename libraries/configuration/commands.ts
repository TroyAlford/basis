/**
 * Non-npm peer-dependency checks.
 *
 * Not every dependency ships on npm. External binaries — `docker`, `op`, `lego`,
 * `nginx`, and the like — are peer dependencies of the host, resolved on `PATH`
 * rather than installed by `bun install`. Basis mandates no specific binary:
 * each application declares the commands it needs and chooses when to validate
 * them, at install time or at launch, with a clear, fail-loud message naming
 * exactly what is missing.
 */

import type { ILogger } from '../utilities'
import { Logger } from '../utilities'

/** Error prefix shared by every configuration failure. */
const PREFIX = '[basis/configuration]'

/** Logger used when a caller does not supply one. */
const defaultLogger: ILogger = new Logger({ prefix: 'commands' })

/** An external command a host must provide, resolved on `PATH`. */
export interface RequiredCommand {
  /** Executable to resolve. */
  readonly command: string,
  /** Human name used in messages. Defaults to {@link RequiredCommand.command}. */
  readonly name?: string,
}

/**
 * Resolve a command name to an absolute path, or `null` when it is absent.
 * Defaults to `Bun.which`.
 */
export type CommandResolver = (command: string) => string | null

/** Options accepted by {@link checkCommands} and {@link requireCommands}. */
export interface CommandOptions {
  /** Log sink for a one-line outcome. Defaults to a `commands`-prefixed logger. */
  readonly logger?: ILogger,
  /** Resolver used to locate commands on `PATH`. Defaults to `Bun.which`. */
  readonly resolve?: CommandResolver,
}

/** The outcome of resolving a set of required commands. */
export interface CommandCheck {
  /** Commands that did not resolve on `PATH`. */
  readonly missing: readonly RequiredCommand[],
  /** Commands that resolved on `PATH`. */
  readonly resolved: readonly RequiredCommand[],
}

/**
 * A command declaration is either a bare name or a `{ command, name }` pair.
 * @param entry - Declaration to normalize.
 * @returns The normalized declaration.
 */
function normalize(entry: string | RequiredCommand): RequiredCommand {
  return typeof entry === 'string' ? { command: entry } : entry
}

/**
 * Resolve every required command on `PATH`, splitting the resolved from the
 * missing. Never throws, so a caller can presence-gate an optional binary.
 * @param commands - Commands the host must provide.
 * @param options - Resolver and log sink.
 * @returns The resolved and missing commands.
 */
export function checkCommands(
  commands: readonly (string | RequiredCommand)[],
  options: CommandOptions = {},
): CommandCheck {
  const resolve = options.resolve ?? Bun.which
  const resolved: RequiredCommand[] = []
  const missing: RequiredCommand[] = []

  for (const entry of commands) {
    const required = normalize(entry)
    if (resolve(required.command) === null) missing.push(required)
    else resolved.push(required)
  }

  return { missing, resolved }
}

/**
 * Fail loudly unless every required command resolves on `PATH`. Consumers
 * declare their own binaries; Basis mandates none.
 * @param commands - Commands the host must provide.
 * @param options - Resolver and log sink.
 * @returns The commands that were required, in declaration order.
 * @throws {Error} Listing the peer-dependencies that did not resolve.
 */
export function requireCommands(
  commands: readonly (string | RequiredCommand)[],
  options: CommandOptions = {},
): readonly RequiredCommand[] {
  const logger = options.logger ?? defaultLogger
  const { missing, resolved } = checkCommands(commands, options)

  if (missing.length > 0) {
    const names = missing.map(({ command, name }) => name ?? command).join(', ')
    const message =
      `${PREFIX} missing required peer-dependencies on PATH: ${names}. ` +
      'Install them and re-run.'
    logger.error(message)
    throw new Error(message)
  }

  logger.info(`resolved peer-dependencies: ${resolved.map(({ command, name }) => name ?? command).join(', ')}`)
  return resolved
}
