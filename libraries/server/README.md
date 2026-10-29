# @basis/server

A Bun application server for Basis React applications. One `Server` supports two explicit modes: a live-development server and a deterministic managed-production runtime.

## Installation

`@basis/server` is consumed from the Basis repository over a pinned Git tag (see [`consumer/README.md`](../../consumer/README.md)). There is no npm/JSR publish step.

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

`root` resolves relative entrypoint and asset paths, `assets` serves a static asset directory, `main` registers the browser entrypoint compiled from source, and `title` sets the SPA document title.

`start` options:

| Option        | Default                       | Purpose                                                     |
| ------------- | ----------------------------- | ----------------------------------------------------------- |
| `development` | `NODE_ENV !== 'production'`   | Select the live-development or managed-production workflow. |
| `hostname`    | `HOST`, then `127.0.0.1`      | Interface to bind.                                          |
| `logger`      | a standard Basis `Logger`     | Sink for server/HMR lifecycle output.                       |
| `port`        | `PORT`, then `80`             | Port to bind. `0` binds an ephemeral port.                  |
| `version`     | `VERSION`, then `development` | Release version reported by `/api/health`.                  |

## Database

`server.database()` configures one server-owned PostgreSQL capability backed by Bun's native SQL pool:

```ts
import { Server } from 'basis/server'

const server = new Server()
  .root(import.meta.dir)
  .main('./Application.tsx')
  .database()
  .start()

await server.db.connect()
// ...
await server.shutdown()
```

With no `url`, the server starts a managed local PostgreSQL container, assigns it an ephemeral host port, and waits for it before reporting healthy. The managed database requires Docker; an application that uses it should declare `"docker"` in `basis.hostDependencies` so install fails early when the host cannot provide it. The server also reports `503 error` from `/api/health` if Docker is unavailable at startup.

Pass `url` to use an external PostgreSQL server instead. `DatabaseOptions` also accepts the pool's `max`, `idleTimeout`, and `connectionTimeout`, defaulting to `10`, `30`, and `10` seconds respectively.

`server.db` always returns a database capability. Without `database()`, it is a `NullDatabase` whose calls fail with a clear configuration error, so callers do not need optional chaining. `connect()` establishes a real connection and rejects when PostgreSQL is unreachable, and `close()` is idempotent. The pool is never a module global, so two servers never share one.

`server.stop()` keeps its synchronous contract and starts database teardown. `server.shutdown()` waits for database, build watcher, and HTTP teardown; `SIGINT`/`SIGTERM` use that graceful path before exiting. Query, transaction, and model APIs are not part of this capability yet.

## Logging

`Server` owns a standard Basis `Logger` and writes its lifecycle output through it: the `listening http://<host>:<port>` startup line, `stopping` on shutdown, build failures, and the development/HMR watcher messages. Applications do not need to construct or configure a logger; use the server's logger for application-specific messages:

```ts
const server = new Server().root(import.meta.dir).main('./Application.tsx')
server.start()
server.logger.info('background worker ready')
```

Records carry a UTC ISO-8601 timestamp (date and timezone), a level, and any automatic runtime context. The platform context (`SERVICE_NAME`, `VERSION`, `GIT_SHA`) is read from the environment, so a managed app is identified without per-app setup. Output stays colorized — including under PM2, whose ANSI styling command-center renders — and only the conventional `NO_COLOR` opt-out (or an explicit `logger: new Logger({ colors: false })`) disables it. Inject a custom `logger` to redirect or silence lifecycle output.

## Development mode

Development runs on Bun's dev server, so updates apply to the running page instead of forcing a full-page reload:

- the SPA shell is generated at startup and served through a Bun HTML route, so Bun owns the module graph, file watching, and hot updates;
- Bun's dev server emits React Fast Refresh registrations only for function components, so the `basis/serve` plugin registers every class component itself and marks its module self-accepting; Bun's own refresh runtime then updates the changed component in place, without reloading the document and without re-rendering the surrounding page or layout chrome (navigation, theme);
- a module that derives state from imported components (for example a route registry) should call `import.meta.hot.accept()` so it re-evaluates and rebuilds that state; an edit with no accepting boundary falls back to a reload;
- styles registered through `style()` reconcile in place by id, so style edits apply without duplication;
- the request's runtime facts are still embedded into the shell the client boots from;
- `/api/health` stays `503 starting` until the first development build succeeds, and reports `503 error` when it fails, so development readiness is honest rather than optimistic;
- dependencies (including React) are bundled by Bun, so no CDN is required; the `/modules` proxy route remains available for explicit module requests but is not used by the default build.

Bun's dev server loads bundler plugins from `bunfig.toml`, so a consuming app registers Basis's SASS and Markdown loaders with:

```toml
[serve.static]
plugins = ["basis/serve"]
```

The trusted `postinstall` hook adds that section automatically (and never touches the Basis monorepo's own `bunfig.toml`). An app that does not use SASS or Markdown does not need it, but it is harmless.

## Production mode

Production is deterministic and self-contained:

- the application builds once at startup, bundling the installed dependency graph, so no third-party CDN is required;
- file watching, HMR, and the development module proxy are not started (production bundles every dependency, including React);
- the SPA shell is served for unmatched paths, alongside configured assets;
- `SIGINT`/`SIGTERM` stop the server and exit cleanly, suitable for PM2.

### Bundled assets

The SPA shell loads entrypoints as classic `<script defer>` tags, so they are compiled as IIFEs (`format: 'iife'`). An entrypoint may export bindings without leaving an `export{…}` statement in the served bundle — which would be a syntax error — and module-local names never leak onto `window`.

Imported non-JS assets (images, fonts, …) are emitted as separate build outputs and served under the same `/scripts/<file>` route as the entrypoints. The bundle references them by an absolute `/scripts/...` URL, so `import icon from
'./icon.png'` works with no extra configuration:

```ts
import icon from './icon.png'

new Server().root(import.meta.dir).main('./Application.tsx').start()
// the bundle references /scripts/icon-<hash>.png; the server serves it
```

`server.assets(...)` remains the way to serve a fixed directory of runtime assets outside the bundler; `server.mount(...)` does the same with an allow-list.

## Readiness and health

`/api/health` is the managed-application readiness API. It only responds `200` once the initial build has succeeded:

```json
{ "status": "ok", "version": "0.6.1" }
```

`version` is the authoritative release version from the strict semver release tag, injected by command-center as `VERSION`; the exact deployed checkout is a separate `GIT_SHA`, and `package.json.version` is never the source.

While the build is pending it responds `503 { "status": "starting", ... }`, and after a failed build `503 { "status": "error", "error": "...", ... }`. A deployment verifier therefore never sees a healthy process for an application that did not build. Bun version and uptime are additive diagnostics on the ready response.

`server.ready()` resolves when the initial build succeeds and rejects when it fails, for processes that prefer to signal readiness directly. In production the process stays up and keeps reporting the failure on `/api/health` rather than crashing, so command-center can observe and act on it.

## API routes

```ts
import { HttpVerb, Server } from 'basis/server'

const server = new Server()
server.api([HttpVerb.Get], 'hello/:name', ({ name }, { logger, request }) => {
  logger.info(`hello ${name}`)
  return new Response(`Hello, ${name}`)
})
```

Templates match only the route under `/api` (`/api/hello/world`). Root paths are the SPA surface, so a template named `art` matches `/api/art` but never claims `/art`; `/ping` is `/api/ping`, not a root route. Every handler receives the request and the server's logger.

## Favicon and icons

Every Basis server serves the favicon at the standard, extensionless `/assets/favicon`, and the shell always links that URL. What it returns depends on configuration and discovery:

```ts
import { TriangleRight } from 'basis/react/icons'
import { Server } from 'basis/server'

// A file is served verbatim (its content type comes from the file).
new Server().main('./index.tsx').favicon('./brand.png')

// A Bun.file works the same way.
new Server().main('./index.tsx').favicon(Bun.file('./brand.ico'))

// An IconBase is rendered as an SVG, with its options applied.
new Server().main('./index.tsx').favicon(TriangleRight, { color: 'ff0000', filled: true })
```

When no favicon is configured, the server discovers `favicon.{ico,svg,png,jpg,jpeg,gif,webp}` (in that order) in the working directory, then `Server.root`, then any `.assets(...)` folder. When nothing is configured or discovered, it serves the **Basis mark**, so every Basis server has a working favicon.

### Icons

Every Basis icon, plus any the app registers, is served as a standalone SVG at `/icons/{Name}.svg`:

```ts
import { Nerd } from './icons/Nerd'
import { Server } from 'basis/server'

new Server().main('./index.tsx').icons({ Nerd })
// GET /icons/TriangleRight.svg?color=ff0000&filled=true&size=32
```

The query contract matches `NerdrageTools/nerdrage`: `color` is a hex value (with or without `#`, default `000000`), `filled` accepts `true`/empty/`filled`, `size` defaults to `1em`, and any other key becomes an icon prop except `stroke`. Registered icons take precedence over Basis's set.

The shell renders `<link rel="icon" href="/assets/favicon">`; development injects that link (Bun's HTML bundler would otherwise try to bundle it), while production renders it directly.

## OAuth

`server.oauth(options)` mounts a provider-agnostic authorization-code flow and wires the session capability into the server:

```ts
import { Identity } from 'basis/oauth'

const identity = new Identity({
  public: Bun.env.OAUTH_CLIENT_ID,
  secret: Bun.env.OAUTH_CLIENT_SECRET,
  scope: Identity.Scope.Domain,
})

server.oauth({
  session: identity,
  redirectUri: 'https://example.com/api/oauth/callback',
  authorize: (state, credentials) => provider.authorizeUrl(state, credentials, redirectUri),
  exchange: (code, credentials) => provider.exchange(code, credentials, redirectUri),
  identity: accessToken => provider.userId(accessToken),
})
```

It registers `/api/oauth/login`, `/api/oauth/callback`, and `/api/oauth/logout`, owns the CSRF state cookie and the redirects, and calls `identity.set(...)` on a successful callback. Provider specifics stay with the caller — Discord, GitHub, Google, and any other OAuth provider work the same way. The client credentials come from the `Identity`, so they are configured in one place.

## Embedding

`server.handle(request)` dispatches one request through the same routing the server uses internally, for hosts that mount Basis Server inside another fetch handler. SSE responses are opted out of the HTTP idle timeout automatically, so idle streams stay open without changing the global timeout.

## Server-sent events

`sse` registers a GET-only event stream. Handlers publish named events and register teardown for client disconnect:

```ts
server.sse('events', (params, { logger }, channel) => {
  const timer = setInterval(() => channel.send('snapshot', currentState()), 2_000)
  channel.onClose(() => clearInterval(timer))
})
```

The server owns the `text/event-stream` framing, proxy-friendly headers (`x-accel-buffering: no`), disconnect cleanup, and a bounded per-connection buffer: if a client stops reading, frames are dropped rather than queued without limit. `channel.send` returns `false` when a frame was dropped.

## WebSockets

`socket` registers a first-class WebSocket route. The server owns routing, upgrade negotiation, and lifecycle dispatch; HMR is implemented as an internal consumer of this same facility rather than a separate mechanism.

```ts
server.socket('room/:id', {
  open: socket => socket.publish('joined', { id: socket.params.id }),
  message: (socket, data) => socket.publish('echo', String(data)),
  close: socket => console.log('left', socket.params.id),
})
```

`Socket.publish(event, data)` writes the `{ event, data }` envelope that the `ServerSocket` client transport consumes; `send` writes a raw frame.

## Static mounts

`mount` serves an allow-listed folder under a URL prefix, with the server owning traversal protection, content type, and missing-file handling. This is the supported way to expose assets that must not pass through the bundler:

```ts
server.mount('/vendor', './node_modules', {
  allow: ['@blueprintjs', 'normalize.css'],
})
```

## Runtime context

The server embeds immutable platform facts (`SERVICE_NAME`, `VERSION`, `GIT_SHA`) into the SPA shell it serves, so the browser boots the application runtime context without an extra fetch. On the client, `ApplicationBase` reads them via `readBasisRuntime()`; see the `@basis/react` runtime surface.

When the server is given an identity capability — through `server.identity(...)` or `server.oauth(...)` — it also verifies the bootstrapping request and embeds the signed-in user id as `runtime.identity` (`null` when anonymous). A consumer frontend therefore reads the signed-in identity from its standard runtime context without implementing a session fetch of its own.

## Documentation

Durable documentation lives under `docs/` as Markdown/MDX. `basis docs check` validates the tree (front-matter, code fences, and repository-relative links), and `basis docs build` projects the same source to a static site (for example GitHub Pages) through this package's renderer.

A documentation site is an app, not a separate server surface: the `Documentation` component from `basis/react` renders the shell, and the `docs/` tree is served by running the docs app through the Basis Server. See `docs/` and `server.ts` in this repository for the reference setup.
