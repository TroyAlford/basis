/**
 * Consumer-facing entrypoint for the shared Basis configuration surface.
 *
 * Re-exports the typed environment wrapper, the 1Password secret reader, the
 * non-npm peer-dependency checks, and the bounded subprocess runner so an
 * external consumer can resolve them from `basis/configuration` without
 * reaching into Basis workspace paths.
 */
export * from '../libraries/configuration'
