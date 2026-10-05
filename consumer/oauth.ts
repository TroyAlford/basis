/**
 * Consumer-facing entrypoint for the shared Basis OAuth surface.
 *
 * Re-exports only the supported capability — `Identity` — so an external
 * consumer can resolve it from `basis/oauth` without reaching into Basis
 * workspace paths. The cookie name, crypto, serialization, scoping, and
 * hostname parsing stay out of the package.
 */

export { Identity } from '../libraries/oauth'
