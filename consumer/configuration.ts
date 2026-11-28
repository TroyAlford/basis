/**
 * Consumer-facing entrypoint for the shared Basis configuration surface.
 *
 * Re-exports only the supported primitives — `Environment` and `secret` — so
 * an external consumer can resolve them from `basis/configuration` without
 * reaching into Basis workspace paths. Internal factories, loading seams, and
 * test-injection points stay out of the package. Subprocess execution is
 * imported from `basis/utilities`.
 */

export { Environment, secret } from '../libraries/configuration'
