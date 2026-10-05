/**
 * Public surface of `basis/configuration`.
 *
 * Three primitives, and only the types a consumer must name to call them:
 *
 * - `Environment` — typed reads over the process environment.
 * - `secret` — 1Password secret reads.
 * - `run` — the shared bounded subprocess runner (`RunOptions`, `CommandResult`).
 *
 * Everything else in the workspace is internal implementation and is
 * deliberately not re-exported: the loading seam (`loadDotenv`), the secret
 * factory and its seams (`createSecretReader`), and their types. Host
 * peer-dependencies are package facts declared as `basis.hostDependencies` and
 * validated by Basis's install hook, not an imperative API.
 */

export { Environment } from './environment'
export { run } from './run'
export type { CommandResult, RunOptions } from './run'
export { secret } from './secret'
