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

`basis/server` exposes the Bun application server:

```ts
import { Server } from 'basis/server'

new Server()
  .root(import.meta.dir)
  .assets('./assets')
  .main('./Application.tsx')
  .start({
    development: Bun.env.NODE_ENV !== 'production',
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 80),
    version: Bun.env.VERSION ?? 'development',
  })
```

One server supports two explicit modes. Development keeps the live-compile,
file-watch, HMR, and module-proxy workflow. Production builds once, bundles the
installed application/Basis dependency graph (so serving never needs a
third-party CDN), serves the SPA and its assets, and shuts down gracefully on
`SIGINT`/`SIGTERM`.

`start` options are `development`, `hostname`, `port`, and `version`; each falls
back to `NODE_ENV`, `HOST`, `PORT`, and `VERSION`. A managed process should bind
loopback and the deployment-assigned port, and pass the release version.

`/health` reports the managed-application contract only once the application is
built and ready:

```json
{ "status": "ok", "version": "0.6.1" }
```

`version` is the authoritative release version from the strict semver release
tag that command-center injects as `VERSION`. The exact deployed checkout is a
separate `GIT_SHA`, and `package.json.version` is never the source.

While the initial build is pending it responds `503 { "status": "starting", ... }`,
and after a failed build `503 { "status": "error", "error": "...", ... }`, so a
verifier can never observe a healthy process for an application that did not
build. `server.ready()` resolves when the build succeeds and rejects when it
fails, for processes that signal readiness directly. Bun version and uptime are
additive diagnostics. The same endpoint is reachable at `/api/health`, and
applications do not have to reimplement it. The server surface shares the React
contract from `basis/react`, and its runtime dependencies are declared by Basis.

`@basis/server` is still maturing; the supported public surface is the `Server`
class, its `ServerOptions`, and the `APIRoute` and `HealthOptions` types.

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
