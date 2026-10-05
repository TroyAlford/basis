/**
 * Configuration and host-integration primitives for first-party applications.
 *
 * This module collects the pieces every app otherwise reimplements: typed,
 * topic-grouped configuration over the process environment (with the standard
 * dotenv precedence), a 1Password secret reader, non-npm peer-dependency checks,
 * and the shared bounded subprocess runner.
 */

export { checkCommands, requireCommands } from './commands'
export type { CommandCheck, CommandOptions, CommandResolver, RequiredCommand } from './commands'
export { createConfiguration, Environment, environmentFiles, loadEnvironment } from './environment'
export type { EnvironmentTopic, LoadEnvironmentOptions } from './environment'
export { run } from './run'
export type { CommandResult, RunOptions } from './run'
export { createSecretReader, secret, SecretReadError } from './secret'
export type { CreateSecretReaderOptions, SecretCommandRunner, SecretReader } from './secret'
