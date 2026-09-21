# Consuming Basis

The Basis repository is the distribution artifact. There is no npm/JSR publish
step and no consumer build step: Bun resolves the source directly from a pinned
Git tag.

## Install

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

`--trust` records `basis` in the consumer's `trustedDependencies` so Basis's
install hook can apply the transitive patches Basis owns. The hook is
deterministic, idempotent, exact-version validated, and only touches packages
Basis declares. Consumers never copy patch files or `patchedDependencies`
entries.

Basis requires Bun `>=1.4.0`. Bun only honors root-level `patchedDependencies`,
which is why the trusted hook exists.

## ESLint

```js
// eslint.config.mjs
export { default } from 'basis/eslint'
```

`basis/eslint` is the shared flat config. Append repository-specific policy
with the factory:

```js
// eslint.config.mjs
import { createConfig } from 'basis/eslint'

export default createConfig({
  overrides: [{ files: ['src/index.ts'], rules: { 'no-console': 'off' } }],
})
```

Every ESLint plugin the config imports is declared by Basis itself, so consumers
do not enumerate or install the plugin stack.

## TypeScript

```json
{
  "extends": "basis/tsconfig/bun.json"
}
```

Presets: `basis/tsconfig/base.json`, `basis/tsconfig/bun.json`,
`basis/tsconfig/react.json`. They contain no Basis-monorepo path mappings.

## Logger

`basis/logger` exports the shared `Logger` and its `ILogger` / `LoggerOptions`
types. Basis owns the logger's dependencies (for example `chalk`), so consumers
do not install them:

```ts
import { Logger } from 'basis/logger'

const logger = new Logger({ prefix: '[app]', logFilePath: '/tmp/app.log', maxLogLines: 5000 })

logger.info('server listening')
const stopwatch = logger.stopwatchStart()
// ...
logger.stopwatchStop(stopwatch, 'request handled')
```

`LoggerOptions` supports `prefix`, `silent`, `logFilePath`, and `maxLogLines`.
Use `withPrefix` to derive a scoped view, and the `stopwatchStart` /
`stopwatchSplit` / `stopwatchStop` helpers to measure durations.

## CLI

```bash
bunx basis doctor     # validate the surface and that owned patches are active
bunx basis lint
bunx basis typecheck
bunx basis check
```

## Patches

Basis currently owns **no** patches, so a normal install applies nothing. The
mechanism remains in place for future Basis-owned patches: patch files live in
`patches/` and are declared in the root `patchedDependencies` map, which is the
manifest the install hook reads.

Bun applies `patchedDependencies` during install, and only from the install
root: a dependency's patches are never applied transitively, and there is no
standalone Bun command that applies an existing patch file. The trusted install
hook therefore applies Basis's exact patch files with `git apply` once the
dependencies are on disk:

- every patch is matched by exact `name@version`;
- every installed copy of that exact version is patched;
- already-applied patches are detected and skipped, so installs are idempotent;
- a patch that no longer matches the installed source, or a missing expected
  version, fails the install loudly.

Git is required (consumers install Basis from Git, and Bun's own patch tooling
also depends on Git). Consumers never copy patch files or `patchedDependencies`.
