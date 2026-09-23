# @basis/server

A Bun application server for Basis React applications. One `Server` supports two
explicit modes: a live-development server and a deterministic managed-production
runtime.

## Installation

`@basis/server` is consumed from the Basis repository over a pinned Git tag (see
[`consumer/README.md`](../../consumer/README.md)). There is no npm/JSR publish
step.

## Usage

```ts
import { Server } from '@basis/server'

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

`root` resolves relative entrypoint and asset paths, `assets` serves a static
asset directory, and `main` registers the browser entrypoint compiled from
source.

`start` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `development` | `NODE_ENV !== 'production'` | Select the live-development or managed-production workflow. |
| `hostname` | `HOST`, then `127.0.0.1` | Interface to bind. |
| `port` | `PORT`, then `80` | Port to bind. `0` binds an ephemeral port. |
| `version` | `VERSION`, then `development` | Release version reported by `/health`. |

## Development mode

Development preserves the live workflow:

- entrypoints are compiled from source and rebuilt on change;
- a Chokidar watcher drives rebuilds;
- a WebSocket broadcasts HMR notifications;
- React/ReactDOM stay external and are loaded as browser globals, proxied through
  the module route.

## Production mode

Production is deterministic and self-contained:

- the application builds once at startup, bundling the installed dependency
  graph, so no third-party CDN is required;
- file watching, HMR, and the module proxy are not started;
- the SPA shell is served for unmatched paths, alongside configured assets;
- `SIGINT`/`SIGTERM` stop the server and exit cleanly, suitable for PM2.

## Readiness and health

`/health` (also `/api/health`) is the managed-application readiness contract. It
only responds `200` once the initial build has succeeded:

```json
{ "status": "ok", "version": "0.6.1" }
```

`version` is the authoritative release version from the strict semver release
tag, injected by command-center as `VERSION`; the exact deployed checkout is a
separate `GIT_SHA`, and `package.json.version` is never the source.

While the build is pending it responds `503 { "status": "starting", ... }`, and
after a failed build `503 { "status": "error", "error": "...", ... }`. A
deployment verifier therefore never sees a healthy process for an application
that did not build. Bun version and uptime are additive diagnostics on the ready
response.

`server.ready()` resolves when the initial build succeeds and rejects when it
fails, for processes that prefer to signal readiness directly. In production the
process stays up and keeps reporting the failure on `/health` rather than
crashing, so command-center can observe and act on it.

## API routes

```ts
import { HttpVerb } from '@basis/utilities'

const server = new Server()
server.api([HttpVerb.Get], 'hello/:name', ({ name }) => new Response(`Hello, ${name}`))
```

Templates match the route under `/api` (`/api/hello/world`) and, for root-level
paths, the first path segment (so built-in `/health` and `/ping` resolve).
