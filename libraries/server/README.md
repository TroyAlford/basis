# @basis/server

A Bun application server for Basis React applications. One `Server` always runs live from source through Bun HMR.

The authoritative API and lifecycle reference is the documentation site: [Server](../../docs/server/index.mdx), [Database & Transactions](../../docs/server/database.mdx), and [Authorization & Row-Level Security](../../docs/server/authorization.mdx). This README is a front door.

## Usage

```ts
import { Server } from 'basis/server'

new Server()
  .root(import.meta.dir)
  .assets('./assets')
  .context(async request => loadApplicationContext(request))
  .main('./Application.tsx')
  .title('My Application')
  .start({
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 80),
    version: Bun.env.VERSION ?? 'development',
  })
```

`root` resolves relative entrypoints and assets, `assets` serves a fixed directory, `context` loads request-scoped application data, `main` registers the application component (which Basis renders on the server and hydrates in the browser), and `title` sets the fallback document title. `start` options are `hostname`, `idleTimeout`, `logger`, `port`, and `version`.

## Lifecycle

The server delegates to Bun's dev server for compilation, watching, HMR, and React Fast Refresh. The same source path serves the SPA and shuts down gracefully on `SIGINT`/`SIGTERM`.

`/api/health` reports readiness: `503 starting` until the initial build and any configured database pool are ready, `503 error` on failure, and `200` only when ready. `server.ready()` exposes the same promise.

## Database

`server.database()` configures the zero-config Basis-managed PostgreSQL capability. The server owns the Bun pool; the managed PostgreSQL service and its durable data survive web-server restarts. See the [database guide](../../docs/server/database.mdx).

`server.graph(graph)` adds the canonical graph roles and compiled PostgreSQL RLS. With authorization enabled, `server.db` uses a restricted application role; the administrative owner connection is reserved for explicit provisioning and is never exposed to handlers. See the [authorization guide](../../docs/server/authorization.mdx).

## Other server facilities

- `api(verbs, template, handler)` registers an API route under `/api`.
- A standard `assets` directory is served automatically; `mount(prefix, folder, { allow })` and `assets(folder)` provide explicit mounts with traversal and `.basis` protection.
- `buildVendor({ entries })` writes content-versioned chunks to `assets/vendor`; the standard `/assets/vendor` subtree gets immutable caching and ETag revalidation automatically.
- `sse(route, handler)` registers a GET event stream.
- `socket(route, handlers)` registers a WebSocket route.
- `oauth(options)` mounts a provider-agnostic OAuth flow.
- `handle(request)` dispatches one request when embedding the server in another host.

Detailed examples for all of these live in the [Server documentation](../../docs/server/index.mdx).
