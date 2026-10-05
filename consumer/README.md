# Consuming Basis

The Basis repository is the distribution artifact. There is no npm/JSR publish
step and no consumer build step: Bun resolves the source directly from a pinned
Git tag.

## Install

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

`--trust` records `basis` in the consumer's `trustedDependencies` so Basis's
install hook can apply the transitive patches Basis owns and provision the
browser runtime `basis/testing` needs. The hook is deterministic, idempotent,
exact-version validated, and only touches packages Basis declares. Consumers
never copy patch files or `patchedDependencies` entries, and never add their own
browser provisioning: `bun install` downloads the pinned Chromium browser. It
never escalates privileges or invokes a system package manager; the
operating-system libraries Chromium needs to launch are the environment's
responsibility (a CI image or a one-time host bootstrap). Set
`BASIS_SKIP_BROWSER_INSTALL=1` to opt out; a download failure fails the install.

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

## CSS linting

Component CSS lives in `*.styles.ts` as `css` tagged template literals. Basis
lints it with Stylelint through the `postcss-styled-syntax` custom syntax, so the
embedded stylesheet is parsed as real CSS (including nesting and `${...}`
interpolations) rather than matched as text.

The supported zero-config route is the CLI, which runs the ESLint and CSS
policies together:

```bash
bunx basis lint
```

To run Stylelint directly, point it at the Basis config:

```bash
bunx stylelint "**/*.styles.ts" --config ./node_modules/basis/stylelint.config.mjs --allow-empty-input
```

A consumer can also adopt the shared config from their own Stylelint
configuration:

```js
// stylelint.config.mjs
export { default } from 'basis/stylelint'
```

`basis/stylelint` exports the ready configuration as its default export and a
`createConfig` factory for appending repository-specific rule settings or
overrides:

```js
import { createConfig } from 'basis/stylelint'

export default createConfig({
  rules: { 'basis/no-state-classes': [true, { ignore: ['open'] }] },
})
```

The policy enforces correctness (parse validity, unknown properties, malformed
selectors, accidental duplicates, lowercase type selectors), deterministic
ordering (custom properties, then ordinary declarations, then nested selector
blocks; safely autofixable), nesting guardrails, and Basis selector semantics.
The deterministic state rule owns one claim — a state class name is transient
state and should not be a class — and never prescribes ARIA or a role, because
CSS cannot know an element's real accessibility semantics. It recommends
genuinely CSS-native state (`:hover`, `:focus`, `:focus-visible`, `[hidden]`),
neutral `data-*` for application state (for example `.active` → `[data-active]`,
`.selected` → `[data-selected]`), and, for `disabled`/`checked`/`invalid`/
`read-only`, the native semantic when the element supports it, otherwise
`data-*`. Structural, component, and mixin classes (`.button.component`,
`.table.editor.component`, `.value`, `.prefix`, `.suffix`) remain valid.
Choosing an existing genuine native/ARIA semantic as the better selector is the
`component-style-semantics` reviewer's job.

Stylelint, the custom syntax, and every plugin are declared by Basis, so
consumers never enumerate the CSS lint dependency or configuration graph.

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

## Configuration

`basis/configuration` collects the host-integration primitives applications
otherwise reimplement:

```ts
import {
  checkCommands,
  createConfiguration,
  createSecretReader,
  Environment,
  requireCommands,
  run,
  secret,
} from 'basis/configuration'
```

- `Environment` (with `Environment.load()` and `loadEnvironment()`) loads the
  standard dotenv files most-specific first — `.env.<mode>.local`, `.env.local`,
  `.env.<mode>`, `.env`, where `<mode>` defaults to `NODE_ENV` then
  `development` — and exposes typed getters (`string`, `number`, `boolean`,
  `required`, `enabled`). `createConfiguration` groups getters by topic, and
  `Environment.enabled(...keys)` computes a topic's `ENABLED` flag.
- `secret<T>(reference)` reads an `op://` reference through the 1Password CLI,
  returning the value typed by its JSON shape. It sets
  `OP_SERVICE_ACCOUNT_TOKEN` and `PATH` on the `op` child, never logs or echoes a
  value, and fails closed when the token is unset. `createSecretReader` injects
  a runner and an explicit token.
- `requireCommands([...])` fails loudly, naming every external binary missing
  from `PATH`, so a host's non-npm peer dependencies (`docker`, `op`, …) are
  validated at install or launch. Basis mandates no specific binary;
  `checkCommands` presence-gates an optional one without throwing.
- `run(command, args, options)` is the shared synchronous, shell-free,
  bounded (`timeoutMs`) subprocess runner, returning captured
  `{ exitCode, stdout, stderr }`.

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

## Testing

`basis/testing` is the single test surface: the shared `render`, `Simulate`, and
`waitFor` helpers, the shared `test`/`it`/`describe` (which track the current
test name for snapshot keys), the `matchScreenshot` visual helper, and
browser-backed snapshots. Add the preload to `bunfig.toml`:

```toml
[test]
preload = ["basis/testing/bun"]
```

It registers happy-dom and the browser lifecycle, so a plain `bun test` runs the
complete suite — DOM tests and browser-backed snapshot tests alike.

`matchScreenshot(subject, hint?, options?)` is an ordinary async function, not a
custom matcher: Bun drives async matchers synchronously, which makes the
Playwright calls inside them far slower than the same calls awaited normally.

```tsx
import { Button } from 'basis/react'
import { matchScreenshot, test } from 'basis/testing'

test('renders a button', async () => {
  await matchScreenshot(<Button>Save</Button>)
})
```

It accepts a React element, a Playwright `Page`, or a `Locator`, and throws with
the diff details on a mismatch.

Basis's trusted install hook downloads the pinned Chromium browser during
`bun install`. It never escalates privileges or invokes a system package manager,
so no `sudo` is ever required. The operating-system libraries Chromium needs to
launch are the environment's responsibility: CI images provide them, and a dev
host provisions them once with `bunx playwright install-deps chromium` (an admin
step, outside the install hook). Set `BASIS_SKIP_BROWSER_INSTALL=1` to opt out
intentionally; the hook then reports the skip. If the download fails, `bun
install` fails loudly and names the command to retry; if Chromium later fails to
launch, the error names the same `install-deps` command and reports the missing
library when it can identify it.

`matchScreenshot` never modifies or deletes a committed baseline unless the run
explicitly updates (`--update-snapshots` / `UPDATE_SNAPSHOTS=1`). A capture or
comparison failure leaves baselines untouched.

### Application tests

Boot the app **once for the whole run** with `useApplication`. The preload stops
it when the run ends, so no test file needs its own `beforeAll`/`afterAll`:

```tsx
import { matchScreenshot, test, useApplication } from 'basis/testing'

test('renders the deck builder', async () => {
  const app = await useApplication({ entry: './src/serve.ts' })

  await app.visit('/deck', async page => {
    await matchScreenshot(page.locator('.deck-builder'))
  })
})
```

Every file shares one server per `(cwd, entry)`; the first caller boots it and
concurrent callers await the same boot. `visit` still gives a deterministic page
(fresh browser context, stubbed network, per-visit `init`), but **server-side
state is shared across the run** — a test that needs a clean server boots its own
with the low-level `startApplication`.

`useApplication` is lazy by default. To boot before the suite and fail fast on a
broken server, add a second preload that calls it (`await useApplication(...)`)
through the same registry — see the testing README for the eager pattern.

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
bunx basis lint       # report the TypeScript/JSX and CSS policies
bunx basis lint --fix # apply every autofixable finding in one run
bunx basis typecheck
bunx basis check
```

`basis lint --fix` forwards `--fix` to both surfaces (ESLint and Stylelint)
and applies the fixes they support in a single pass. A follow-up `basis lint`
reports nothing fixable that the first run did not already resolve; rulings
without a safe transformation (for example JSDoc contracts and `max-len`)
still require a manual edit. `basis check --fix` applies the same lint fixes
before it typechecks.

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
