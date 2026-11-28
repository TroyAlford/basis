# Consuming Basis

Basis is distributed as a pinned Git dependency. Bun resolves the source directly from the released tag; there is no package-registry publish step and no consumer build step.

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

Use a released tag rather than a branch. `--trust` records Basis in `trustedDependencies` so its install hook can apply Basis-owned patches and validate declared host capabilities.

The documentation site built from [`docs/`](../docs/index.mdx) is the authoritative reference. This README is the front door: install, first imports, and links.

## Supported imports

```ts
import { Button, Theme } from 'basis/react'
import { Server } from 'basis/server'
import { Environment } from 'basis/configuration'
import { run, runAsync } from 'basis/utilities'
import { Logger } from 'basis/logger'
import { Identity } from 'basis/oauth'
import { matchScreenshot, test, useApplication } from 'basis/testing'
```

Supported surfaces are `basis/cli`, `basis/configuration`, `basis/eslint`, `basis/logger`, `basis/markdown`, `basis/oauth`, `basis/react`, `basis/react/icons`, `basis/review`, `basis/serve`, `basis/server`, `basis/stylelint`, `basis/testing`, `basis/testing/bun`, and `basis/tsconfig/*`. Internal workspaces are not consumer imports; see [Reference](../docs/reference.mdx).

## Host capabilities and patches

Declare non-npm host capabilities in the application root:

```json
{ "basis": { "hostDependencies": ["docker"] } }
```

The install hook resolves each declared capability on `PATH` and fails loudly when it is missing or broken. Basis-owned patches live in the package and are applied by that hook; consumers never copy patch files or add their own `patchedDependencies` entries. See [Installation](../docs/installation.mdx).

## Lint, format, compliance, and typecheck

```bash
bunx basis lint
bunx basis format
bunx basis compliance
bunx basis typecheck
```

`basis lint` uses the Basis style policy when the repository has no ESLint config. Add `export { default } from 'basis/eslint'` to adopt or extend it explicitly. Markdown and `*.styles.ts` coverage is part of the same CLI. `basis compliance` runs the same style and typecheck surface plus the authoritative architecture and infrastructure rules. Choose `lint` or `compliance` for a repository gate, not both. See [CLI](../docs/cli.mdx), [ESLint](../docs/eslint.mdx), [Compliance](../docs/compliance.mdx), and [TypeScript](../docs/typescript.mdx).

`basis typecheck` runs Bun's built-in TypeScript checker and requires Bun 1.4.3 or newer. `basis lint` and `basis compliance` run Bun's built-in linter; use the pinned canary or a future stable release that ships `bun lint` (stable 1.4.5 does not). The full Basis Server install requires Bun 1.4.6 or the approved canary described in [Installation](../docs/installation.mdx). The install hook and `Server.start()` enforce the server requirement. Installing Basis does not enforce the typecheck or linter minimums by itself; those commands perform their own checks.

## Server and database

```ts
import { Server } from 'basis/server'

new Server()
  .root(import.meta.dir)
  .main('./Application.tsx')
  .database()
  .start()
```

`server.database()` is zero-config and creates the Basis-managed PostgreSQL capability. `server.db.sql` is Bun's pooled tagged-template API, and `server.db.tx(async sql => ...)` owns a transaction boundary. See [Server](../docs/server/index.mdx), [Database & Transactions](../docs/server/database.mdx), and [Authorization & Row-Level Security](../docs/server/authorization.mdx).

## Testing

Add the preload to `bunfig.toml`:

```toml
[test]
preload = ["basis/testing/bun"]
```

A test file's suffix selects its lane: `*.test.ts(x)` runs by default; `*.screenshot.tsx` and `*.e2e.ts` are opt-in lanes run by the repository scripts. `basis/testing` provides `render`, `Simulate`, `waitFor`, `matchScreenshot`, and `useApplication`. See [Testing & Visual Snapshots](../docs/testing.md).

## Documentation

Use the documentation site as the package API and usage reference. The canonical source is [`docs/`](../docs/index.mdx). In the Basis repository, validate it with `bun run docs:check` and build it with `bun run docs:build`; consumers can use `basis docs check` and `basis docs build` for their own trees.
