import type { Server as BunServer, ServerWebSocket } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { IndexHTML } from '../../react/components/IndexHTML/IndexHTML'
import type { BasisRuntime, ILogger, URI } from '../../utilities'
import { HttpVerb, Logger, parseTemplateURI, parseURI } from '../../utilities'
import type { HealthStatus } from '../apis/health'
import { health } from '../apis/health'
import { ping } from '../apis/ping'
import type { APIRoute } from '../types/APIRoute'
import type { RouteContext } from '../types/RouteContext'
import type { Socket, SocketHandlers } from '../types/Socket'
import type { SseHandler } from '../types/SseChannel'
import { Builder } from './Builder'
import type { SocketData } from './Sockets'
import { createSocket, normalizeSocketTemplate } from './Sockets'
import { sseResponse } from './Sse'
import type { StaticMount } from './StaticMount'
import { normalizeMountPrefix, serveMount } from './StaticMount'

/** Options for {@link Server.start}. */
export interface ServerOptions {
  /**
   * Run the live-development build/watch/HMR workflow. Development compiles
   * from source and rebuilds on change; dependencies are bundled by default, so
   * no CDN is required. When `false`, the server builds once and does not watch
   * or broadcast HMR.
   * Defaults to `NODE_ENV !== 'production'`.
   */
  development?: boolean,
  /** Interface to bind. Defaults to `HOST`, then `127.0.0.1`. */
  hostname?: string,
  /**
   * HTTP idle timeout in seconds passed to `Bun.serve` (maximum 255; `0`
   * disables it globally). SSE responses always opt out per request, so this
   * only affects other requests; leave unset for Bun's default.
   */
  idleTimeout?: number,
  /**
   * Log sink for server/HMR lifecycle output. Defaults to a standard Basis
   * {@link Logger} carrying the platform context (`SERVICE_NAME`, `VERSION`,
   * `GIT_SHA`) and colorized output. Inject one to customize or silence it.
   */
  logger?: ILogger,
  /** Port to bind. Defaults to `PORT`, then `80`. Use `0` for an ephemeral port. */
  port?: number,
  /**
   * Release version reported by `/health` and embedded as runtime context.
   * Defaults to `VERSION`, then `development`. Alforge supplies this as the
   * authoritative release version from the strict semver release tag (for
   * example `0.6.1`); the exact deployed checkout is a separate `GIT_SHA`, and
   * `package.json.version` is never the source.
   */
  version?: string,
}

/**
 * A server for building, serving, and (in development) hot reloading React
 * applications.
 *
 * One server supports two explicit modes. Development keeps live-compile,
 * file-watch, and HMR, bundling dependencies by default (an opt-in
 * `globals` mode reuses browser-global builds through the module proxy).
 * Production builds once, bundles the installed dependency graph, serves the
 * SPA and its assets, reports the release version on `/health`, and shuts down
 * gracefully on SIGINT/SIGTERM.
 *
 * Beyond `api` routes, the server owns first-class SSE (`sse`), WebSocket
 * (`socket`), and static-mount (`mount`) facilities. HMR is implemented as an
 * internal consumer of the same WebSocket facility, not a separate mechanism.
 */
export class Server {
  static BadRequest: Response = new Response(null, { status: 400, statusText: 'Bad Request' })
  static NotFound: Response = new Response(null, { status: 404, statusText: 'Not Found' })

  #apis = new Map<string, APIRoute>()
  #assets: string | null = null
  #builder: Builder | null = null
  #development = true
  #entrypoints: [string, string][] = []
  #hmrClients = new Set<Socket>()
  #logger: ILogger = new Logger()
  #modules = new Map<string, string>()
  #mounts: StaticMount[] = []
  #ready: Promise<void> = Promise.resolve()
  #readyError: Error | null = null
  #root: string = process.cwd()
  #server: BunServer<SocketData> | null = null
  #sockets = new Map<string, SocketHandlers>()
  #sse = new Map<string, SseHandler>()
  #status: HealthStatus = 'starting'
  #title = 'Document'
  #version = 'development'

  constructor() {
    this.api([HttpVerb.Get], 'health', () => this.#health())
    this.api([HttpVerb.Get], 'ping', ping)
    /*
     * HMR is an internal consumer of the general WebSocket facility: it is just
     * a socket route whose connections the server broadcasts to on rebuild.
     */
    this.socket('hmr', {
      close: socket => {
        this.#hmrClients.delete(socket)
      },
      open: socket => {
        this.#hmrClients.add(socket)
      },
    })
  }

  /**
   * Whether the server is running the development workflow.
   * @returns `true` when the server is in development mode.
   */
  get development(): boolean {
    return this.#development
  }

  /**
   * The bound hostname.
   * @returns The bound hostname, or `undefined` before starting.
   */
  get hostname(): string | undefined {
    return this.#server?.hostname
  }

  /**
   * The logger the server uses for lifecycle output.
   *
   * Applications should log through this surface so their messages share the
   * standard format, platform context, and colorized output. Inject a custom
   * logger through {@link ServerOptions.logger} to redirect or silence it.
   * @returns The server's logger.
   */
  get logger(): ILogger {
    return this.#logger
  }

  /**
   * The bound port.
   * @returns The bound port, or `undefined` before starting.
   */
  get port(): number | undefined {
    return this.#server?.port
  }

  /**
   * Immutable runtime facts embedded into the SPA shell for the client
   * application context. `SERVICE_NAME`, `VERSION`, and `GIT_SHA` are read from
   * the platform environment; unknown values are `null`.
   * @returns The runtime facts.
   */
  get runtime(): BasisRuntime {
    return {
      gitSha: nonEmpty(Bun.env.GIT_SHA),
      serviceName: nonEmpty(Bun.env.SERVICE_NAME),
      version: this.#version === 'development' ? nonEmpty(Bun.env.VERSION) : this.#version,
    }
  }

  /**
   * Resolves once the application's initial build succeeds, or rejects when it
   * fails. A managed process can await this before signalling readiness;
   * `/health` stays `503` until the same point.
   * @returns A promise that settles when the app is built and ready.
   */
  ready(): Promise<void> {
    return this.#ready
  }

  /**
   * Processes an API request.
   *
   * Templates match the route under `/api`, and additionally the first path
   * segment at the root, so conventional endpoints such as `/health` and
   * `/api/health` both resolve.
   * @param uri - The URI to handle.
   * @param request - The incoming request.
   * @returns The API response, or `null` when no template matches.
   */
  async handleAPI(uri: URI, request: Request): Promise<Response | null> {
    const context: RouteContext = { logger: this.#logger, request }

    for (const target of this.#targets(uri)) {
      if (!target) continue

      for (const [template, { handler, verbs }] of this.#apis.entries()) {
        if (!verbs.has(request.method as HttpVerb)) continue

        const params = parseTemplateURI(target, template)
        if (!params) continue

        return await handler(params, context)
      }
    }

    return null
  }

  /**
   * Handles a request against the registered static mounts.
   * @param uri - The URI to handle.
   * @returns The mounted response, or `null` when no mount claims the path.
   */
  async handleMount(uri: URI): Promise<Response | null> {
    for (const mount of this.#mounts) {
      const response = await serveMount(mount, uri.path)
      if (response !== null) return response
    }
    return null
  }

  /**
   * Processes an SSE request (GET only).
   * @param uri - The URI to handle.
   * @param request - The incoming request.
   * @returns The event-stream response, a `405`, or `null` when no template matches.
   */
  async handleSse(uri: URI, request: Request): Promise<Response | null> {
    for (const target of this.#targets(uri)) {
      if (!target) continue

      for (const [template, handler] of this.#sse.entries()) {
        const params = parseTemplateURI(target, template)
        if (!params) continue
        if (request.method !== 'GET') {
          return new Response(null, {
            headers: { allow: 'GET' },
            status: 405,
            statusText: 'Method Not Allowed',
          })
        }
        return sseResponse(params, { logger: this.#logger, request }, handler)
      }
    }

    return null
  }

  /**
   * Handles an asset request.
   * @param uri - The URI to handle.
   * @returns The asset response.
   */
  async handleAsset(uri: URI): Promise<Response> {
    if (!this.#assets) return Server.NotFound

    const asset = Bun.file(path.join(this.#assets, uri.route))
    if (await asset.exists() === false) return Server.NotFound

    const version = asset.lastModified.toString()

    try {
      if (uri.query.has('v', version)) {
        return new Response(asset, {
          headers: { 'Content-Type': asset.type, 'ETag': version },
          status: 200,
        })
      } else {
        uri.query.set('v', version)
        return new Response(null, {
          headers: { Location: uri.toString() },
          status: 307,
        })
      }
    } catch {
      return Server.NotFound
    }
  }

  /**
   * Handles a module request.
   *
   * Module proxying exists only to back the browser-globals development build;
   * production never reaches a CDN.
   * @param uri - The URI to handle.
   * @returns The module response.
   */
  async handleModule(uri: URI): Promise<Response> {
    if (!this.#development) return Server.NotFound

    if (!this.#modules.has(uri.route)) {
      const response = await fetch(`https://unpkg.com/${uri.route}`)
      if (!response.ok) return Server.NotFound

      const text = await response.text()
      this.#modules.set(uri.route, text)
    }

    return new Response(this.#modules.get(uri.route), {
      headers: {
        'Content-Length': this.#modules.get(uri.route).length.toString(),
        'Content-Type': 'application/javascript',
        'Via': '@basis/server; proxying unpkg.com',
      },
    })
  }

  /**
   * Handles a script request.
   * @param uri - The URI to handle.
   * @returns The script response.
   */
  async handleScripts(uri: URI): Promise<Response> {
    if (!this.#builder) return Server.NotFound

    // A failed build rejects the output promise; serve nothing rather than 500.
    const built = await this.#builder.getOutputs().catch(() => [])
    const script = built.find(s => s.name === uri.route)
    if (!script) return Server.NotFound

    return new Response(await script.output.text(), {
      headers: { 'Content-Type': script.output.type },
      status: 200,
      statusText: 'OK',
    })
  }

  /**
   * Handles a UI request.
   * @returns The UI response.
   */
  async handleUI(): Promise<Response> {
    const html = await renderToString(React.createElement(IndexHTML, {
      runtime: this.runtime,
      scripts: this.#scriptNames(),
      title: this.#title,
    }))
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }

  /**
   * Starts the server.
   *
   * Managed deployments inject `VERSION` (the authoritative release version,
   * for example `0.6.1`) and `GIT_SHA` (the exact deployed checkout). This
   * server echoes `VERSION` on `/health` and embeds all three platform facts
   * into the SPA shell as client runtime context.
   *
   * Lifecycle output (startup, shutdown, build failures, HMR) is written
   * through the server's {@link Logger}, which picks up `SERVICE_NAME`,
   * `VERSION`, and `GIT_SHA` automatically.
   * @param options - The options to start the server with.
   * @param options.development - Whether to run the development workflow.
   * @param options.hostname - The interface to bind.
   * @param options.idleTimeout - HTTP idle timeout in seconds (`idleTimeout` for `Bun.serve`).
   * @param options.logger - Log sink for lifecycle output.
   * @param options.port - The port to bind.
   * @param options.version - The release version reported by `/health`.
   * @returns The server.
   */
  start = ({
    development = Bun.env.NODE_ENV !== 'production',
    hostname = Bun.env.HOST ?? '127.0.0.1',
    idleTimeout,
    logger,
    port = Number(Bun.env.PORT ?? 80),
    version = Bun.env.VERSION ?? 'development',
  }: ServerOptions = {}): Server => {
    if (logger) this.#logger = logger
    this.#development = development
    this.#version = version

    const builder = new Builder({
      development,
      logger: this.#logger,
      onRebuild: () => {
        this.#readyError = null
        this.#status = 'ok'
        this.#broadcast()
      },
      root: this.#root,
      watch: development,
    })

    for (const [name, file] of this.#entrypoints) {
      void builder.add(name, file)
    }

    if (development) {
      void builder.add('hmr.js', path.join(import.meta.dir, 'hmr.ts'))
    }

    this.#builder = builder
    this.#readyError = null
    this.#status = 'starting'
    this.#ready = builder.initialBuild()
      .then(() => undefined)
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.#readyError = failure
        this.#status = 'error'
        this.#logger.error(`build failed: ${failure.message}`)
        throw failure
      })
    // Avoid an unhandled rejection when a caller never awaits `ready()`.
    void this.#ready.catch(() => undefined)

    this.#server = Bun.serve({
      development,
      fetch: this.#handleRequest,
      hostname,
      ...(idleTimeout === undefined ? {} : { idleTimeout }),
      port,
      websocket: {
        close: (ws, code, reason) => {
          this.#sockets.get(ws.data.route)?.close?.(this.#socketFor(ws), code, reason)
        },
        message: (ws, message) => {
          this.#sockets.get(ws.data.route)?.message?.(this.#socketFor(ws), message)
        },
        open: ws => {
          const socket = createSocket(ws)
          ws.data.socket = socket
          this.#sockets.get(ws.data.route)?.open?.(socket)
        },
      },
    })

    process.on('SIGINT', this.#handleSignal)
    process.on('SIGTERM', this.#handleSignal)

    this.#logger.info(`listening http://${this.#server.hostname}:${this.#server.port}`)

    return this
  }

  /**
   * Stops the server and its build watcher.
   * @returns The server.
   */
  stop = (): Server => {
    process.off('SIGINT', this.#handleSignal)
    process.off('SIGTERM', this.#handleSignal)

    this.#logger.info('stopping')

    this.#hmrClients.clear()

    void this.#builder?.stop()
    this.#builder = null

    this.#server?.stop()
    this.#server = null

    return this
  }

  /**
   * Sets the main entrypoint for the server.
   * @param filePath - The path to the entrypoint.
   * @returns The server.
   */
  main(filePath: string): Server {
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.#root, filePath)
    this.#checkPath(absolute)

    this.#entrypoints.push(['index.js', absolute])
    void this.#builder?.add('index.js', absolute)
    return this
  }

  /**
   * Sets the root directory for the server.
   * @param absolutePath - The absolute path to the root directory.
   * @returns The server.
   */
  root(absolutePath: string): Server {
    this.#checkPath(absolutePath)
    this.#root = absolutePath
    return this
  }

  /**
   * Sets the SPA document title.
   * @param title - The document title.
   * @returns The server.
   */
  title(title: string): Server {
    this.#title = title
    return this
  }

  #checkPath(absolutePath: string): void {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Path "${absolutePath}" does not exist`)
    }
  }

  /**
   * Adds an API route to the server.
   * @param verbs - The HTTP methods to handle.
   * @param template - The template URI to handle.
   * @param handler - The handler for the API route.
   * @returns The server.
   */
  api<Params extends object = object>(
    verbs: HttpVerb[],
    template: string,
    handler: (params: Params, context: RouteContext) => Response | Promise<Response>,
  ): Server {
    this.#apis.set(template, { handler, verbs: new Set(verbs) })
    return this
  }

  /**
   * Adds a GET-only Server-Sent Events route.
   *
   * The handler receives a bounded {@link SseChannel}; it may return a disposer
   * that runs when the client disconnects.
   * @param template - The template URI to handle.
   * @param handler - The SSE handler.
   * @returns The server.
   */
  sse<Params extends object = object>(template: string, handler: SseHandler<Params>): Server {
    this.#sse.set(template, handler)
    return this
  }

  /**
   * Adds a first-class WebSocket route.
   * @param template - The path template to upgrade, for example `hmr` or `/room/:id`.
   * @param handlers - Lifecycle handlers for connected clients.
   * @returns The server.
   */
  socket(template: string, handlers: SocketHandlers): Server {
    this.#sockets.set(template, handlers)
    return this
  }

  /**
   * Serves an allow-listed folder under a URL prefix.
   *
   * The server owns traversal protection, allow-list enforcement, content type,
   * and missing-file handling, so a consumer can expose a directory (for
   * example legacy vendor assets) without a bespoke route.
   * @param prefix - URL prefix to mount, for example `/vendor`.
   * @param folder - Folder to serve, absolute or relative to the server root.
   * @param options - Optional allow-list of top-level entries beneath the mount.
   * @param options.allow - Top-level files/folders permitted; all when omitted.
   * @returns The server.
   */
  mount(prefix: string, folder: string, options: { allow?: readonly string[] } = {}): Server {
    const absolute = path.isAbsolute(folder) ? folder : path.join(this.#root, folder)
    if (!fs.existsSync(absolute)) {
      throw new Error(`Mount folder "${absolute}" does not exist`)
    }

    this.#mounts.push({
      allow: options.allow ?? null,
      folder: absolute,
      prefix: normalizeMountPrefix(prefix),
    })
    return this
  }

  /**
   * Sets the assets folder for the server.
   * @param folder - The folder to set as the assets folder.
   * @returns The server.
   */
  assets(folder: string): Server {
    const absolute = path.isAbsolute(folder) ? folder : path.join(this.#root, folder)
    if (!fs.existsSync(absolute)) {
      throw new Error(`Assets folder "${absolute}" does not exist`)
    }

    this.#assets = absolute
    return this
  }

  /** Broadcasts a rebuild notification to connected development clients. */
  #broadcast(): void {
    if (!this.#development) return

    this.#logger.info('[HMR] Rebuild complete')
    const message = JSON.stringify({ timestamp: Date.now(), type: 'hmr' })
    for (const socket of this.#hmrClients) socket.send(message)
  }

  /**
   * Builds the health response for the current readiness state.
   * @returns The health response.
   */
  #health(): Response {
    return health({
      error: this.#readyError?.message,
      status: this.#status,
      version: this.#version,
    })
  }

  /**
   * Handles an incoming request across both modes.
   * @param request - The incoming request.
   * @returns The response, or `undefined` when a WebSocket upgrade is handled.
   */
  #handleRequest = async (request: Request): Promise<Response | undefined> => {
    // Every WebSocket upgrade is dispatched to a registered socket route.
    if (request.headers.get('upgrade') === 'websocket') {
      const uri = parseURI(request.url)
      const match = this.#matchSocket(uri.path)
      if (match === null) {
        return new Response('WebSocket route not found', { status: 404 })
      }
      const upgraded = this.#server?.upgrade(request, {
        data: { params: match.params, route: match.route, socket: null },
      })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined // Bun handles the upgrade
    }

    const uri = parseURI(request.url)

    const sse = await this.handleSse(uri, request)
    if (sse) {
      /*
       * An SSE stream may be quiet for a long time between events. Bun's HTTP
       * idle timeout would otherwise close it and `EventSource` would
       * reconnect, so opt this request out of the timeout. This is scoped to
       * the SSE request and leaves the global timeout untouched.
       */
      if (sse.headers.get('content-type')?.includes('text/event-stream')) {
        this.#server?.timeout(request, 0)
      }
      return sse
    }

    const api = await this.handleAPI(uri, request)
    if (api) return api

    const mounted = await this.handleMount(uri)
    if (mounted) return mounted

    switch (uri.type) {
      case 'api': return Server.BadRequest
      case 'assets': return this.handleAsset(uri)
      case 'modules': return this.handleModule(uri)
      case 'scripts': return this.handleScripts(uri)
      default: return this.handleUI()
    }
  }

  /**
   * Find the socket route matching a request pathname.
   * @param pathname - The request pathname.
   * @returns The matched handlers, params, and template, or `null`.
   */
  #matchSocket(pathname: string): {
    readonly handlers: SocketHandlers,
    readonly params: Record<string, string>,
    readonly route: string,
  } | null {
    for (const [template, handlers] of this.#sockets.entries()) {
      const params = parseTemplateURI(pathname, normalizeSocketTemplate(template))
      if (params) return { handlers, params, route: template }
    }
    return null
  }

  /**
   * Resolve the socket view for a connection, reusing the one built on open.
   * @param ws - The raw Bun socket.
   * @returns The Basis socket view.
   */
  #socketFor(ws: ServerWebSocket<SocketData>): Socket {
    return ws.data.socket ?? createSocket(ws)
  }

  /**
   * The route targets a URI can match, matching the API convention: the route
   * under `/api`, or the first path segment at the root.
   * @param uri - The parsed URI.
   * @returns Candidate template targets.
   */
  #targets(uri: URI): string[] {
    return uri.type === 'api' ? [uri.route] : uri.route ? [] : [uri.type]
  }

  /** Handles process shutdown signals by stopping and exiting cleanly. */
  #handleSignal = (): void => {
    this.stop()
    process.exit(0)
  }

  /**
   * The script URIs the UI should load for the current mode.
   * @returns The script names to include in the rendered UI.
   */
  #scriptNames(): string[] {
    const names = this.#entrypoints.map(([name]) => name)
    if (this.#development) names.push('hmr.js')
    return names
  }
}

/**
 * Normalize an optional environment value.
 * @param value - Raw environment value.
 * @returns The trimmed value, or `null` when effectively unset.
 */
function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
