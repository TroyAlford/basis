# `@basis/configuration`

Configuration and host-integration primitives shared by first-party
applications, exposed to consumers as `basis/configuration`.

Four pieces, each with an obvious reason to exist and its own module:

| Module | Responsibility |
| --- | --- |
| `environment.ts` | Typed, topic-grouped configuration over the standard dotenv files |
| `secret.ts` | 1Password secret reads through the `op` CLI |
| `commands.ts` | Non-npm peer-dependency (external binary) checks |
| `run.ts` | The shared synchronous, bounded subprocess runner |

## Environment

`loadEnvironment` reads the standard dotenv files most-specific first —
`.env.<mode>.local`, `.env.local`, `.env.<mode>`, then `.env` — where `<mode>`
defaults to `NODE_ENV`, then `development`. A value already present in the
process environment always wins, so real environment variables override files.
`Environment` exposes typed getters; `createConfiguration` groups them by topic.

```ts
import { createConfiguration, Environment } from 'basis/configuration'

const env = new Environment()
const ENV = createConfiguration({
  /** 1Password: the secret provider. */
  ONE_PASSWORD: reader => ({
    /** Whether 1Password is configured. */
    get ENABLED(): boolean { return reader.enabled('OP_SERVICE_ACCOUNT_TOKEN') },
  }),
  /** Runtime identity and mode. */
  RUNTIME: reader => ({
    get MODE(): string { return reader.value('NODE_ENV') ?? 'production' },
    get PRODUCTION(): boolean { return reader.production },
  }),
})

ENV.ONE_PASSWORD.ENABLED // computed flag
ENV.RUNTIME.MODE // typed string
```

The `env` above is only needed if you read values outside a topic.

Getters are `string`, `number` (finite, else fallback), `boolean`
(`true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`), `required` (fail loud), and
`value`. `enabled(...keys)` computes a topic's `ENABLED` flag; `mode`,
`production`, and `development` describe the run.

## Secrets

`secret<T>(reference)` reads one `op://` reference through the 1Password CLI
(`op read <reference>`) and returns it typed by shape: a JSON object, array,
number, or boolean is parsed, while a plain string is returned raw with one
trailing newline removed. The reader never caches, never persists, and never
injects a value into a process environment.

The Service Account token is a credential supplied to the `op` child only.
`OP_SERVICE_ACCOUNT_TOKEN` and `PATH` form the child's environment, the
reference is the sole argument, and a missing token fails closed before any
subprocess starts. Values and tokens never appear in logs or errors.

```ts
import { createSecretReader, secret } from 'basis/configuration'

const token = secret<string>('op://Vault/item/field') // ambient OP_SERVICE_ACCOUNT_TOKEN

const reader = createSecretReader({ opBin: 'op', runner: myRunner, token })
const settings = reader.secret<{ port: number }>('op://Vault/item/settings')
```

## Peer dependencies

Not every dependency ships on npm. `requireCommands` validates external binaries
resolved on `PATH` and fails loudly, naming every missing one. Basis mandates no
specific binary — consumers declare their own (`docker`, `op`, …) — and choose
when to validate, at install time or at launch.

```ts
import { checkCommands, requireCommands } from 'basis/configuration'

requireCommands(['docker', 'nginx']) // throws unless both resolve on PATH
requireCommands([{ command: 'op', name: 'op' }])

if (!checkCommands(['opencode']).missing.length) enableOpenCode()
```

`checkCommands` never throws, so an optional binary can be presence-gated.

## Subprocesses

`run(command, args, options)` is the single bounded runner the ecosystem shares:
synchronous, shell-free (an explicit argv), with `cwd`, environment overrides,
`timeoutMs`, and a Basis `Logger`. It returns `{ exitCode, stdout, stderr }` and
logs the command line and any failure, so applications stop reimplementing it.
