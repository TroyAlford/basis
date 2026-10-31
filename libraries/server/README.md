# @basis/server

A Bun application server for Basis React applications. One `Server` supports live development with Bun HMR and a deterministic managed-production runtime.

The authoritative API and lifecycle reference is the documentation site: [Server](../../docs/server/index.mdx). This README is a front door.

## Usage

```ts
import { Server } from 'basis/server'

new Server()
  .root(import.meta.dir)
  .assets('./assets')
  .main('./Application.tsx')
  .title('My Application')
  .start({
    development: Bun.env.NODE_ENV !== 'production',
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 80),
    version: Bun.env.VERSION ?? 'development',
  })
```

`root` resolves relative entrypoints and assets, `assets` serves a fixed directory, `main` registers the browser entrypoint, and `title` sets the SPA document title. `start` options are `development`, `hostname`, `idleTimeout`, `logger`, `port`, and `version`.

## Lifecycle

Development delegates to Bun's dev server for compilation, watching, HMR, and React Fast Refresh. Production builds once, bundles the dependency graph, serves the SPA and assets, and shuts down gracefully on `SIGINT`/`SIGTERM`.

`/api/health` reports readiness: `503 starting` until the initial build is ready, `503 error` on failure, and `200` only when ready. `server.ready()` exposes the same promise.

## Other server facilities

- `api(verbs, template, handler)` registers an API route under `/api`.
- `mount(prefix, folder, { allow })` and `assets(folder)` serve static files with traversal and `.basis` protection.
- `sse(route, handler)` registers a GET event stream.
- `socket(route, handlers)` registers a WebSocket route.
- `oauth(options)` mounts a provider-agnostic OAuth flow.
- `handle(request)` dispatches one request when embedding the server in another host.

Detailed examples for all of these live in the [Server documentation](../../docs/server/index.mdx).
