# `@basis/oauth`

Shared cross-subdomain identity mechanics for first-party applications,
exposed to consumers as `basis/oauth`.

The package owns one capability: **`Identity`**, a stateless identity cookie
whose value is the user id sealed with a provider secret. It is
transport-shaped, not policy-shaped. It owns the cookie name, the sealed
value's format, and the cookie's browser scope; it does not read a request's
cookie itself, decide who is allowed in, or keep server-side session state.

## Public surface

Two exports, and nothing else:

| Export | Kind |
| --- | --- |
| `Identity` | The identity capability |
| `Identity.Scope` | The two cookie scopes, `Domain` and `Subdomain` |

Everything else is internal implementation and is deliberately not
re-exported: the crypto scheme, the blob layout, the cookie serializer, the
hostname parser, and the resolved client credentials. Consumers must not need
to know about crypto, cookie names, serialization, scoping mechanics, or
hostname parsing.

## Usage

```ts
import { Identity } from 'basis/oauth'

const identity = new Identity({
  public: 'op://Vault/OAuth/client-id', // client id; may be an op:// reference
  secret: 'op://Vault/OAuth/client-secret', // sealing secret; may be an op:// reference
  scope: Identity.Scope.Domain, // optional; default Identity.Scope.Subdomain
  maxAgeSeconds: 60 * 60 * 24 * 30, // optional; default 30 days
})

try {
  const userId = await signIn(request) // your OAuth dance

  identity.set(request, responseHeaders, userId) // sign in
  identity.get(request) // -> the verified user id, or null
  identity.set(request, responseHeaders, null) // sign out (clears at the same scope)
} finally {
  response // has the Set-Cookie header appended
}
```

There are no per-call knobs: cookie name, scope, secret, serialization, and
lifetime are all constructor policy with good defaults.

## Scope

Only two browser behaviors exist, so only two scopes exist:

- **`Identity.Scope.Subdomain`** (default) writes a **host-only** cookie with no
  `Domain` attribute: exactly the request hostname.
- **`Identity.Scope.Domain`** writes `Domain=<parent>` so the cookie covers the
  parent domain and all of its descendants.

`set` reads the host from `new URL(request.url).hostname`. For `Domain` scope,
the parent is derived by **removing the request's current subdomain** — the
first label — so `auth.example.co.uk` → `example.co.uk` and
`cc.troyalford.com` → `troyalford.com`. There is no public-suffix list and no
guessing beyond that rule.

A host with two labels or fewer has no parent a browser would accept, so
`Domain` scope **degrades to host-only** there: `example.com`, `foo.localhost`,
and `localhost` all set a host-only cookie. That is the only scope achievable
from such a host, and it is honest about it.

## Identity value

The value is `<version>.<payload>`. The payload is the base64url encoding of
one AES-256-GCM blob — the 12-byte nonce, the 16-byte authentication tag, then
the ciphertext — and the version prefix (`v1`) lets the scheme evolve.

The AES key is SHA-256 over the ownership namespace `basis/oauth/identity`, the
version, and the resolved provider secret. The secret must be high-entropy (a
provider/client secret): the derivation is a fast hash, not a
password-stretching function. Credentials may be literals or `op://`
references; references are resolved through `basis/configuration`'s `secret()`
the first time they are needed, so an `Identity` can be constructed without
1Password configured.

`get` returns the user id only when the cookie decodes and authenticates under
the secret. A tampered value, a wrong secret, a truncated value, an unknown
version, and an absent cookie all return `null`, so callers fail closed without
a try/catch. Neither a user id nor a secret is ever logged.

## Server integration

`basis/server` builds on `Identity`:

- `server.oauth(options)` mounts a provider-agnostic authorization-code flow at
  `/api/oauth/login`, `/api/oauth/callback`, and `/api/oauth/logout`. Provider
  specifics (`authorize`, `exchange`, `identity`) are injected; the flow owns
  the CSRF state cookie, the redirects, and the session cookie. See the
  `@basis/server` README.
- Configuring `server.oauth(...)` (or `server.identity(...)`) verifies every UI
  request and embeds the signed-in user id as `runtime.identity`, so a consumer
  frontend reads it from its standard runtime context with no fetch of its own.
