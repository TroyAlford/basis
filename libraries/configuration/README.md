# `@basis/configuration`

Configuration and host-integration primitives shared by first-party
applications, exposed to consumers as `basis/configuration`.

## Public surface

Three primitives, plus the types a consumer must name to call `run`:

| Export | Kind |
| --- | --- |
| `Environment` | Typed reads over the process environment |
| `secret` | 1Password secret reads |
| `run`, `RunOptions`, `CommandResult` | Bounded subprocess runner |

Everything else is internal implementation and is deliberately not
re-exported: the dotenv loading seam (`loadDotenv`), the secret reader factory
(`createSecretReader`) and its injection seams, and their types. Consumers own
their configuration policy — defaults, required keys, and enabling conditions —
over Basis's value-reading substrate; there is no `createConfiguration`.

Host peer-dependencies are package facts, not runtime API: declare them in
`package.json` as `basis.hostDependencies` and Basis's install hook validates
them (see `consumer/README.md`).

## Environment

On import, the standard dotenv files load most-specific first —
`.env.<mode>.local`, `.env.local`, `.env.<mode>`, then `.env` — where `<mode>`
is `NODE_ENV`, defaulting to `development`. dotenv's ordered `path` gives the
precedence, and a value already present in the process environment always wins,
so real environment variables override files. There is no loading control plane.

`Environment` reads values; a blank value counts as unset. Unset values fall
back, while a present-but-invalid value throws naming the key, so a typo in
deployment configuration is never mistaken for an intended default.

```ts
import { Environment } from 'basis/configuration'

const env = new Environment()

env.string('HOST', '127.0.0.1') // string, or the fallback
env.number('PORT', 80) // finite number, or the fallback; throws on "garbage"
env.boolean('DEBUG') // true/false/1/0/yes/no/on/off, or the fallback; throws on "maybe"
env.required('DATABASE_URL') // fails loudly, naming the key, when unset
env.enabled('OP_SERVICE_ACCOUNT_TOKEN') // computed ENABLED flag
```

Group getters by topic in the consumer so each enabling condition lives in one
place:

```ts
const ENV = {
  ONE_PASSWORD: {
    get ENABLED(): boolean { return env.enabled('OP_SERVICE_ACCOUNT_TOKEN') },
  },
}
```

## Secrets

`secret(reference)` runs `op read <reference>` through the shared `run` and
returns the value as a string. Read structured configuration by parsing it:
`JSON.parse(secret('op://Vault/item/json'))`.

1Password is the only store: the read never caches, never persists, and never
injects a value into a process environment. The Service Account token is read
from `OP_SERVICE_ACCOUNT_TOKEN` and handed to the `op` child under that same
name — the variable `op` actually reads — with the process environment overlaid,
so `PATH` and everything else the host exports remain available. A missing token
fails closed before any subprocess starts. The reference is the sole argument,
and neither the token nor the value is ever logged or echoed.

```ts
import { secret } from 'basis/configuration'

const token = secret('op://Vault/item/field') // ambient OP_SERVICE_ACCOUNT_TOKEN
const settings = JSON.parse(secret('op://Vault/item/settings'))
```

## Subprocesses

`run(command, args, options)` is the single bounded runner the ecosystem shares:
synchronous, shell-free (an explicit argv), with `cwd`, environment overrides,
`timeoutMs`, and a Basis `Logger`. It returns `{ exitCode, stdout, stderr }` and
logs the command line and any failure, so applications stop reimplementing it.
