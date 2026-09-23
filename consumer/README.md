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

Basis targets TypeScript 7 (the native compiler). Since TS 7 ships no
programmatic API, the workspace installs it side-by-side:

- `@typescript/native` (aliased to `typescript@^7`) provides the native `tsc`
  that `basis typecheck` / `basis check` run.
- `typescript` is aliased to `@typescript/typescript6` so tooling that needs the
  TypeScript 6 API (notably typescript-eslint) keeps working.

The presets target TS 6/7 and so omit options removed in that release (for
example `downlevelIteration`).

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

## React runtime

`basis/react` exposes the supported React component library:

```tsx
import { AutoComplete, Button, Theme } from 'basis/react'
```

Basis owns the React runtime contract. React and ReactDOM are pinned at
`^19.3.0` in Basis's manifest, and Basis also declares the React type packages
(`@types/react`, `@types/react-dom`) and its other runtime dependencies
(`@floating-ui/dom`). A consumer that pins the same React range resolves one
deduplicated React runtime rather than a copy per package.

Components are consumed directly from source — there is no Basis build step. The
surface is self-contained: internal imports resolve through package-relative
paths, so `basis/react` never needs Basis-workspace path aliases, a consumer
resolver plugin, or `node_modules/basis/libraries/*` imports.

## Server runtime

`basis/server` exposes the Bun development server:

```ts
import { Server } from 'basis/server'
```

The server surface shares the same React contract, and its runtime dependencies
(for example `chokidar`, the Babel parser stack, and the `less`/`sass` plugins
used by `@basis/bun-plugins`) are declared by Basis so consumers do not install
them. `@basis/server` is not yet production-ready; the supported public surface
is the `Server` class and the `APIRoute` type.

Only the deliberately supported surfaces above are exported. Internal
workspaces are not exposed just because they exist.

## Review policy

```ts
import { STANDARD_REVIEW_MANIFEST, composeReviewPolicy } from 'basis/review'
```

`basis/review` exposes the shared, versioned reviewer policy (see
`libraries/review/README.md`). Reviewers are authored as Markdown documents with
YAML front-matter; resolve the repository's effective policy by composing the
standard manifest with the Markdown overlays under `.basis/reviewers/`
(`loadOverlayDirectory`), addressed by stable id. Basis owns the policy only —
running detectors, calling models, and publishing reviews belong to the consumer.

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
