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
  .title('My Application')
  .start({
    development: Bun.env.NODE_ENV !== 'production',
    hostname: Bun.env.HOST ?? '127.0.0.1',
    port: Number(Bun.env.PORT ?? 80),
    version: Bun.env.VERSION ?? 'development',
  })
```

`root` resolves relative entrypoint and asset paths, `assets` serves a static
asset directory, `main` registers the browser entrypoint compiled from source,
and `title` sets the SPA document title.

`start` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `development` | `NODE_ENV !== 'production'` | Select the live-development or managed-production workflow. |
| `hostname` | `HOST`, then `127.0.0.1` | Interface to bind. |
| `logger` | a standard Basis `Logger` | Sink for server/HMR lifecycle output. |
| `port` | `PORT`, then `80` | Port to bind. `0` binds an ephemeral port. |
| `version` | `VERSION`, then `development` | Release version reported by `/health`. |

## Logging

`Server` owns a standard Basis `Logger` and writes its lifecycle output through
it: the `listening http://<host>:<port>` startup line, `stopping` on shutdown,
build failures, and the development/HMR watcher messages. Applications do not
need to construct or configure a logger; use the server's logger for
application-specific messages:

```ts
const server = new Server().root(import.meta.dir).main('./Application.tsx')
server.start()
server.logger.info('background worker ready')
```

Records carry a UTC ISO-8601 timestamp (date and timezone), a level, and any
automatic runtime context. The platform context (`SERVICE_NAME`, `VERSION`,
`GIT_SHA`) is read from the environment, so a managed app is identified without
per-app setup. Output stays colorized — including under PM2, whose ANSI styling
command-center renders — and only the conventional `NO_COLOR` opt-out (or an
explicit `logger: new Logger({ colors: false })`) disables it. Inject a custom
`logger` to redirect or silence lifecycle output.


## Development mode

Development preserves the live workflow:

- entrypoints are compiled from source and rebuilt on change;
- a Chokidar watcher drives rebuilds;
- a WebSocket (served through the general `socket` facility) broadcasts HMR notifications;
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
server.api([HttpVerb.Get], 'hello/:name', ({ name }, { logger, request }) => {
  logger.info(`hello ${name}`)
  return new Response(`Hello, ${name}`)
})
```

Templates match the route under `/api` (`/api/hello/world`) and, for root-level
paths, the first path segment (so built-in `/health` and `/ping` resolve). Every
handler receives the request and the server's logger.

## Server-sent events

`sse` registers a GET-only event stream. Handlers publish named events and
register teardown for client disconnect:

```ts
server.sse('events', (params, { logger }, channel) => {
  const timer = setInterval(() => channel.send('snapshot', currentState()), 2_000)
  channel.onClose(() => clearInterval(timer))
})
```

The server owns the `text/event-stream` framing, proxy-friendly headers
(`x-accel-buffering: no`), disconnect cleanup, and a bounded per-connection
buffer: if a client stops reading, frames are dropped rather than queued without
limit. `channel.send` returns `false` when a frame was dropped.

## WebSockets

`socket` registers a first-class WebSocket route. The server owns routing,
upgrade negotiation, and lifecycle dispatch; HMR is implemented as an internal
consumer of this same facility rather than a separate mechanism.

```ts
server.socket('room/:id', {
  open: socket => socket.publish('joined', { id: socket.params.id }),
  message: (socket, data) => socket.publish('echo', String(data)),
  close: socket => console.log('left', socket.params.id),
})
```

`Socket.publish(event, data)` writes the `{ event, data }` envelope that the
`ServerSocket` client transport consumes; `send` writes a raw frame.

## Static mounts

`mount` serves an allow-listed folder under a URL prefix, with the server owning
traversal protection, content type, and missing-file handling. This is the
supported way to expose assets that must not pass through the bundler:

```ts
server.mount('/vendor', './node_modules', {
  allow: ['@blueprintjs', 'normalize.css'],
})
```

## Runtime context

The server embeds immutable platform facts (`SERVICE_NAME`, `VERSION`,
`GIT_SHA`) into the SPA shell it serves, so the browser boots the application
runtime context without an extra fetch. On the client, `ApplicationBase` reads
them via `readBasisRuntime()`; see the `@basis/react` runtime surface.

