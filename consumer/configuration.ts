/**
 * Consumer-facing entrypoint for the shared Basis configuration surface.
 *
 * Re-exports only the supported primitives — `Environment`, `secret`, and `run`
 * — so an external consumer can resolve them from `basis/configuration` without
 * reaching into Basis workspace paths. Internal factories, loading seams, and
 * test-injection points stay out of the package.
 */

export { Environment, run, secret } from '../libraries/configuration'
export type { CommandResult, RunOptions } from '../libraries/configuration'
