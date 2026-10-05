/**
 * Public surface of `basis/configuration`.
 *
 * Three primitives, and only the types a consumer must name to call them:
 *
 * - `run` — the shared bounded subprocess runner.
 * - `Environment` / `loadEnvironment` — typed configuration over the process
 *   environment, including the host peer-dependency check (`requireCommands`).
 * - `secret` — 1Password secret reads.
 *
 * Everything else in the workspace is internal implementation and is
 * deliberately not re-exported: factories and test seams (`createSecretReader`,
 * `createConfiguration`), per-module helpers (`environmentFiles`,
 * `checkCommands`), and internal types.
 */

export { Environment, loadEnvironment, requireCommands } from './environment'
export type { LoadEnvironmentOptions, RequiredCommand } from './environment'
export { run } from './run'
export type { CommandResult, RunOptions } from './run'
export { SecretReadError, secret } from './secret'
