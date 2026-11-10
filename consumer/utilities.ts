/**
 * Consumer-facing entrypoint for the Basis utilities surface.
 *
 * Re-exports supported deterministic primitives so applications can use the
 * same state-directory and checksum contracts as Basis without importing
 * internal workspace paths.
 */
export * from '../libraries/utilities'
