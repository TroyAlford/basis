/**
 * Consumer-facing entrypoint for the Basis server runtime surface.
 *
 * Re-exports the supported `@basis/server` API, notably the `Server` class, so an
 * external consumer can `import { Server } from 'basis/server'` without reaching
 * into Basis workspace paths.
 */
export * from '../libraries/server'
