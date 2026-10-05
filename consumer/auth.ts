/**
 * Consumer-facing entrypoint for the shared Basis auth surface.
 *
 * Re-exports only the supported primitives — the identity encrypt/read pair,
 * the cookie writers, and the registrable-domain helper — so an external
 * consumer can resolve them from `basis/auth` without reaching into Basis
 * workspace paths. Key derivation, blob layout, and the hostname parser stay
 * out of the package.
 */

export {
  clearIdentityCookie,
  encryptIdentity,
  readIdentity,
  registrableDomain,
  setIdentityCookie,
} from '../libraries/auth'
export type { ClearIdentityCookieOptions, SetIdentityCookieOptions } from '../libraries/auth'
