# `@basis/auth`

Shared cross-subdomain identity-cookie mechanics for first-party
applications, exposed to consumers as `basis/auth`.

The package owns one capability: a stateless identity cookie whose value is the
user id sealed with a provider secret. It is transport-shaped, not
policy-shaped. It encrypts and reads the value, derives the domain to scope the
cookie, and writes `Set-Cookie`; it does not read a request's cookie, decide who
is allowed in, or keep any server-side session state.

## Public surface

Five primitives, plus the two option types a caller must name:

| Export | Kind |
| --- | --- |
| `encryptIdentity`, `readIdentity` | Seal and open the cookie value |
| `setIdentityCookie`, `clearIdentityCookie`, `SetIdentityCookieOptions`, `ClearIdentityCookieOptions` | `Set-Cookie` writers |
| `registrableDomain` | Derive the shared domain from a request host |

Everything else is internal implementation and is deliberately not
re-exported: the key derivation, the GCM blob layout, the attribute builder,
and the hostname parser. There is no request-reading helper and no
authorization policy; callers own both.

## Identity value

The value is `<version>.<payload>`, where the payload is the base64url encoding
of one AES-256-GCM blob — the 12-byte nonce, the 16-byte authentication tag,
then the ciphertext. The version prefix (`v1`) lets the scheme evolve.

The AES key is SHA-256 over a fixed context, the version, and the provider
secret. The secret must therefore be high-entropy (a provider or client
secret): the derivation is a fast hash, not a password-stretching function.

`readIdentity` returns the user id only when the value decodes and authenticates
under the supplied secret. Tampering, a wrong secret, a truncated value, an
unknown version, and a missing cookie all return `null`, so callers can fail
closed without a try/catch. Neither a user id nor a secret is ever logged.

```ts
import { encryptIdentity, readIdentity } from 'basis/auth'

const value = encryptIdentity(user.id, providerSecret) // put in the cookie
const userId = readIdentity(cookie, providerSecret) // string, or null when untrusted
```

## Cookies

`setIdentityCookie(headers, name, userId, options)` appends a `Set-Cookie`
header. The cookie is host-only by default — `Path=/`, `HttpOnly`, `Secure`,
`SameSite=Lax` — with a **30-day** default `Max-Age`, overridable with
`maxAgeSeconds`. Passing `domain` adds `Domain=<domain>` to share identity
across subdomains; callers pass the registrable domain.

`clearIdentityCookie(headers, name, { domain? })` appends the matching
expiry (`Max-Age=0`). Use the same `domain` the cookie was set with to remove
the shared cookie, or omit it to remove the host-only one.

```ts
import { clearIdentityCookie, registrableDomain, setIdentityCookie } from 'basis/auth'

const domain = registrableDomain(request.headers.get('host')) // e.g. troyalford.com
const headers = new Headers()

// Shared across app.example.com and admin.example.com.
setIdentityCookie(headers, 'ad_identity', user.id, { domain, secret })

// Later, sign out everywhere in the domain.
clearIdentityCookie(headers, 'ad_identity', { domain })
```

## Registrable domain

`registrableDomain(host)` lowercases the host, strips any port, and applies one
documented rule:

- `localhost` and any `*.localhost` become `localhost`.
- IPv4 literals are returned unchanged.
- Otherwise the **last two labels** are kept: `cc.troyalford.com` →
  `troyalford.com`, `troyalford.com` → `troyalford.com`.
- A blank or missing host returns `''`, which callers treat as host-only.

The last-two-labels rule does not consult the public suffix list, so
`example.co.uk` yields `co.uk`. Deployments under a multi-label public suffix
pass the explicit domain to `setIdentityCookie` instead.
