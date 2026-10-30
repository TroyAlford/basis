# Basis

Basis is a Bun-first monorepo: class-based React components, the Basis application server, configuration, logging, OAuth, testing, review policy, and repository tooling. It is consumed as a pinned Git dependency, not from npm.

```bash
bun add --dev --trust github:TroyAlford/basis#vX.Y.Z
```

## Documentation

The documentation site is the authoritative reference for every public surface. Start with:

- [Installation](./docs/installation.mdx) — pinned install, trusted dependencies, first imports, host capabilities.
- [Server](./docs/server/index.mdx) — lifecycle, API routes, assets, health, SSE, sockets.
- [Database & Transactions](./docs/server/database.mdx) — managed PostgreSQL, `db.sql`, `db.tx`.
- [Reference](./docs/reference.mdx) — supported imports and internal-workspace boundaries.
- [Architecture](./docs/architecture.mdx) — system shape and invariants.

Root, `consumer/`, and workspace READMEs are front doors. They describe the package and link to the site rather than duplicating its API inventory.

## Development

```bash
bun install
bun run build
bun test
bun run docs:check
bun run docs:build
```

The docs app lives in [`libraries/docs`](./libraries/docs). The durable documentation source is [`docs/`](./docs/index.mdx). [`AGENTS.md`](./AGENTS.md) is the coding-agent entry point.

## CI

Basis publishes a portable, locally validated GitHub Actions pattern for low-cost pull-request checks. Start with [`docs/ci.mdx`](./docs/ci.mdx); reference workflows live under [`docs/examples`](./docs/examples), and `bun run ci:verify` runs the static contract tests plus an optional `act` dry-run without contacting GitHub Actions.
