/**
 * Consumer-facing entrypoint for the shared Basis configuration surface.
 *
 * Re-exports only the supported primitives — `run`, the environment surface
 * (`Environment`, `loadEnvironment`, `requireCommands`), and `secret` — so an
 * external consumer can resolve them from `basis/configuration` without
 * reaching into Basis workspace paths. Internal factories and test seams stay
 * out of the package.
 */

export { Environment, loadEnvironment, requireCommands, run, SecretReadError, secret } from '../libraries/configuration'
export type { CommandResult, LoadEnvironmentOptions, RequiredCommand, RunOptions } from '../libraries/configuration'
