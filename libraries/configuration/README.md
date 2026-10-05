# `@basis/configuration`

Configuration and host-integration primitives shared by first-party
applications, exposed to consumers as `basis/configuration`.

## Public surface

Three primitives, plus only the types a consumer must name:

| Export | Kind |
| --- | --- |
| `run`, `RunOptions`, `CommandResult` | Bounded subprocess runner |
| `Environment`, `loadEnvironment`, `LoadEnvironmentOptions` | Typed configuration over the process environment |
| `requireCommands`, `RequiredCommand` | Host peer-dependency check (part of the environment surface) |
| `secret`, `SecretReadError` | 1Password secret reads |

Everything else is internal implementation and is deliberately not
re-exported: the factories and test seams `createSecretReader` and
`createConfiguration`, the per-module helpers `environmentFiles` and
`checkCommands`, and their types.

Internally the workspace is organized one responsibility per module:
`environment.ts` (dotenv loading, typed getters, grouping), `secret.ts`
(1Password), `commands.ts` (external binaries), and `run.ts` (subprocesses).
The peer-dependency check is folded into the environment surface because
external binaries are part of the host the configuration describes; it is not a
second public entrypoint.

## Environment

`loadEnvironment` reads the standard dotenv files most-specific first —
`.env.<mode>.local`, `.env.local`, `.env.<mode>`, then `.env` — where `<mode>`
defaults to `NODE_ENV`, then `development`. A value already present in the
process environment always wins, so real environment variables override files.
`Environment` exposes typed getters, grouped by the topic that owns them:

```ts
import { Environment, loadEnvironment } from 'basis/configuration'

loadEnvironment()
const env = new Environment()

env.value('NODE_ENV') // trimmed, non-empty, or undefined
env.string('HOST', '127.0.0.1') // string, or the fallback
env.number('PORT', 80) // finite number, or the fallback
env.boolean('DEBUG') // true/false/1/0/yes/no/on/off, or the fallback
env.required('DATABASE_URL') // fails loudly, naming the key, when unset
env.enabled('OP_SERVICE_ACCOUNT_TOKEN') // computed ENABLED flag
env.mode // NODE_ENV, then development
env.production // mode === 'production'
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

### Host peer dependencies

Not every dependency ships on npm. `requireCommands` validates external binaries
resolved on `PATH` and fails loudly, naming every missing one. Basis mandates no
specific binary — consumers declare their own (`docker`, `op`, …) — and choose
when to validate, at install time or at launch.

```ts
import { requireCommands } from 'basis/configuration'

requireCommands(['docker', 'nginx']) // throws unless both resolve on PATH
requireCommands([{ command: 'op', name: 'op' }])
```

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
import { secret } from 'basis/configuration'

const token = secret<string>('op://Vault/item/field') // ambient OP_SERVICE_ACCOUNT_TOKEN
const settings = secret<{ port: number }>('op://Vault/item/settings')
```

## Subprocesses

`run(command, args, options)` is the single bounded runner the ecosystem shares:
synchronous, shell-free (an explicit argv), with `cwd`, environment overrides,
`timeoutMs`, and a Basis `Logger`. It returns `{ exitCode, stdout, stderr }` and
logs the command line and any failure, so applications stop reimplementing it.
