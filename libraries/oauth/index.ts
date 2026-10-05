/**
 * Public surface of `basis/oauth`.
 *
 * One capability: `Identity`, the shared cross-subdomain identity cookie. It
 * owns the cookie name, the sealed value's format, and its browser scope
 * (`Identity.Scope.Domain` / `Identity.Scope.Subdomain`), so a consumer signs a
 * user in with `set` and reads the verified user id back with `get`.
 *
 * Everything else is internal implementation and is deliberately not
 * re-exported: the AES-256-GCM scheme, the versioned blob layout, the cookie
 * serializer, the hostname parser, and the resolved client credentials. The
 * package is transport-shaped, not policy-shaped — it neither decides who is
 * allowed in nor exposes a per-call cookie name, domain, secret, or lifetime.
 */

export { Identity } from './identity'
