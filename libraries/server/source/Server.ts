import type { Server as BunServer, ServerWebSocket } from 'bun'
import type { FSWatcher } from 'chokidar'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import type { Identity } from '../../oauth'
import type { HeadCollector } from '../../react/components/Head/Head'
import { HeadProvider } from '../../react/components/Head/Head'
import { IndexHTML } from '../../react/components/IndexHTML/IndexHTML'
import type { BasisRuntime, ILogger, URI } from '../../utilities'
import { HttpVerb, Logger, parseTemplateURI, parseURI, serializeBasisRuntime } from '../../utilities'
import type { HealthStatus } from '../apis/health'
import { health } from '../apis/health'
import { ping } from '../apis/ping'
import type { APIRoute } from '../types/APIRoute'
import type { RouteContext } from '../types/RouteContext'
import type { Socket, SocketHandlers } from '../types/Socket'
import type { SseHandler } from '../types/SseChannel'
import { runAsActor } from './ActorContext'
import { Authorization } from './Authorization'
import type { CookieChange } from './Cookies'
import { Cookies, serializeCookie } from './Cookies'
import type { Database, DatabaseOptions, ManagedDatabaseOptions } from './Database'
import { createDatabase, NullDatabase, openAdmin } from './Database'
import { DEV_SHELL_ROUTE, devShellDirectory, writeDevShell, writeHydrationEntry } from './DevShell'
import type { FavIconInput, IconOptions, IconRegistry, ResolvedFavIcon } from './FavIcon'
import { FAVICON_URL, favIconResponse, iconResponse, matchIconPath, resolveFavIcon, resolveIcon } from './FavIcon'
import type { Graph } from './Graph'
import type { OAuthOptions } from './OAuth'
import { OAuth } from './OAuth'
import type { MigrationArtifact } from './Schema'
import { DDL, physicalHash } from './Schema'
import type { SocketData } from './Sockets'
import { createSocket, normalizeSocketTemplate } from './Sockets'
import { sseResponse } from './Sse'
import type { StaticMount } from './StaticMount'
import { containsInternalStateSegment, isInternalStatePath, normalizeMountPrefix, publicStaticFile, serveMount } from './StaticMount'

/** Request-scoped data supplied to a {@link Server.context} loader. */
export interface ContextInput<CookieSchema extends Record<string, string> = Record<string, string>> {
  /** Parsed request cookies. */
  readonly cookies: Cookies<CookieSchema>,
  /** Request-scoped database capability. */
  readonly db: Database,
  /** Verified canonical user id, or null for anonymous. */
  readonly identity: string | null,
  /** Server lifecycle logger. */
  readonly logger: ILogger,
  /** The incoming request. */
  readonly request: Request,
}

/** Application context plus optional response metadata. */
export interface ContextResult<AppContext extends object> {
  /** Application context value. */
  readonly context: AppContext,
  /** Response cookies. */
  readonly cookies?: CookieChange | readonly CookieChange[],
  /** Response headers, excluding cookies. */
  readonly headers?: HeadersInit,
}

type ContextLoader<
  AppContext extends object,
  CookieSchema extends Record<string, string>,
> = (
  input: ContextInput<CookieSchema>,
) => AppContext | ContextResult<AppContext> | Promise<AppContext | ContextResult<AppContext>>

interface ResolvedContext<AppContext extends object> {
  readonly context: AppContext,
  readonly cookies: readonly CookieChange[],
  readonly headers: Headers,
}

/** Options for {@link Server.start}. */
export interface ServerOptions {
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
   * Release version reported by `/api/health` and embedded as runtime context.
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
 * The server always delegates to Bun's dev server: the SPA shell is generated
 * and served through an HTML route, so Bun owns live compilation, file
 * watching, hot module replacement, and React Fast Refresh. A changed module is
 * replaced in place — no document reload — and only falls back to a reload when
 * nothing accepts the update.
 *
 * Beyond `api` routes, the server owns first-class SSE (`sse`), WebSocket
 * (`socket`), and static-mount (`mount`) facilities.
 */
export class Server<
  AppContext extends object = Record<string, never>,
  CookieSchema extends Record<string, string> = Record<string, string>,
> {
  static BadRequest: Response = new Response(null, { status: 400, statusText: 'Bad Request' })
  static NotFound: Response = new Response(null, { status: 404, statusText: 'Not Found' })

  #apis = new Map<string, APIRoute<object, AppContext>>()
  #assets: string | null = null
  #authorization: Authorization | null = null
  #graph: Graph | null = null
  #closing: Promise<void> | null = null
  #database: Database = new NullDatabase()
  #databaseOptions: DatabaseOptions | null = null
  #contextCache = new WeakMap<Request, Promise<ResolvedContext<AppContext>>>()
  #contextLoader: ContextLoader<AppContext, CookieSchema> | null = null
  #mainComponent: React.ComponentType<AppContext> | null = null
  #mainComponentVersion = -1
  #mainBuilds = new Map<number, Promise<React.ComponentType<AppContext>>>()
  #mainPath: string | null = null
  #mainVersion = 0
  #ssrScope = Math.random().toString(16).slice(2)
  #watcher: FSWatcher | null = null
  #favIcon: ResolvedFavIcon | null = null
  #favIconInput: FavIconInput | null = null
  #favIconOptions: IconOptions = {}
  #icons: IconRegistry = {}
  #identity: Identity | null = null
  #logger: ILogger = new Logger()
  #mounts: StaticMount[] = []
  #ready: Promise<void> = Promise.resolve()
  #readyError: Error | null = null
  #schemaExpectation: MigrationArtifact | null = null
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
   * The canonical authorization capability when configured.
   * @returns The authorization service, or null.
   */
  get auth(): Authorization | null {
    return this.#authorization
  }

  /**
   * The server-owned database capability.
   *
   * A server always has a database capability. When {@link database} has not
   * configured one, this is a {@link NullDatabase} whose calls fail gracefully.
   * @returns The database capability.
   */
  get db(): Database {
    return this.#database
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
      identity: null,
      serviceName: nonEmpty(Bun.env.SERVICE_NAME),
      version: this.#version === 'development' ? nonEmpty(Bun.env.VERSION) : this.#version,
    }
  }

  /**
   * Resolves once the application's initial build succeeds, or rejects when it
   * fails. A managed process can await this before signalling readiness;
   * `/api/health` stays `503` until the same point.
   * @returns A promise that settles when the app is built and ready.
   */
  ready(): Promise<void> {
    return this.#ready
  }

  /**
   * Sets the application context loader for this server.
   *
   * The loader runs once per request and its result is available to API
   * handlers and the server-rendered application.
   * @param loader - Request-scoped context resolver.
   * @returns The server, typed with the resolved context.
   */
  context<C extends object, S extends Record<string, string> = CookieSchema>(
    loader: ContextLoader<C, S>,
  ): Server<C, S> {
    const typed = this as unknown as Server<C, S>
    typed.#contextLoader = loader
    return typed
  }

  /**
   * Resolves the application context once for a request.
   * @param request - The incoming request.
   * @param identity - The verified canonical user id, or null.
   * @returns The cached context promise.
   */
  #resolveContext(request: Request, identity: string | null): Promise<ResolvedContext<AppContext>> {
    const cached = this.#contextCache.get(request)
    if (cached) return cached

    const loader = this.#contextLoader
    const resolved = (async () => {
      if (!loader) {
        return { context: {} as AppContext, cookies: [], headers: new Headers() }
      }

      const value = await loader({
        cookies: new Cookies<CookieSchema>(request.headers.get('cookie')),
        db: this.#database,
        identity,
        logger: this.#logger,
        request,
      })
      if (isContextResult<AppContext>(value)) {
        const cookies = value.cookies === undefined
          ? []
          : Array.isArray(value.cookies) ? value.cookies : [value.cookies]
        return { context: value.context, cookies, headers: new Headers(value.headers) }
      }

      return { context: value, cookies: [], headers: new Headers() }
    })()
    this.#contextCache.set(request, resolved)
    return resolved
  }

  /**
   * Merge context response metadata onto a handler or SSR response.
   * @param response - The response produced by the route or shell.
   * @param resolved - The request context metadata.
   * @returns A response with app headers and cookies applied.
   */
  #withContextResponse(
    response: Response,
    resolved: ResolvedContext<AppContext>,
  ): Response {
    for (const [name, value] of resolved.headers) {
      if (name.toLowerCase() === 'set-cookie') {
        throw new Error('Basis: set response cookies through context.cookies, not context.headers')
      }
      response.headers.append(name, value)
    }
    for (const cookie of resolved.cookies) {
      response.headers.append('Set-Cookie', serializeCookie(cookie))
    }
    return response
  }

  /**
   * Processes an API request.
   *
   * API templates match only under `/api`. Root paths are the application's
   * SPA surface, so a template such as `art` matches `/api/art` but never
   * claims `/art`; non-API root paths fall through to the SPA shell.
   * @param uri - The URI to handle.
   * @param request - The incoming request.
   * @returns The API response, or `null` when no template matches.
   */
  async handleAPI(uri: URI, request: Request): Promise<Response | null> {
    const verified = this.#identity?.get(request) ?? null
    const identity = this.#authorization
      ? await this.#authorization.resolve(verified)
      : verified
    return runAsActor({ id: identity }, async () => {
      const resolved = await this.#resolveContext(request, identity)
      const context: RouteContext<AppContext> = {
        context: resolved.context,
        db: this.#database,
        identity,
        logger: this.#logger,
        request,
      }

      for (const target of this.#targets(uri)) {
        if (!target) continue

        for (const [template, { handler, verbs }] of this.#apis.entries()) {
          if (!verbs.has(request.method as HttpVerb)) continue

          const params = parseTemplateURI(target, template)
          if (!params) continue

          return this.#withContextResponse(await handler(params, context), resolved)
        }
      }

      return null
    })
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
    for (const target of this.#sseTargets(uri)) {
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
        const verified = this.#identity?.get(request) ?? null
        const identity = this.#authorization
          ? await this.#authorization.resolve(verified)
          : verified
        return runAsActor({ id: identity }, async () => {
          const resolved = await this.#resolveContext(request, identity)
          const context = {
            context: resolved.context,
            db: this.#database,
            identity,
            logger: this.#logger,
            request,
          } as RouteContext
          return this.#withContextResponse(await sseResponse(params, context, handler), resolved)
        })
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
    if (!this.#assets || isInternalStatePath(uri.route)) return Server.NotFound

    const filePath = path.join(this.#assets, uri.route)
    if (containsInternalStateSegment(this.#assets) || containsInternalStateSegment(filePath)) {
      return Server.NotFound
    }

    const asset = await publicStaticFile(filePath)
    if (!asset) return Server.NotFound

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
   * Handles a UI request.
   *
   * When an {@link Server.identity} capability is configured, the request is
   * verified through it and the signed-in user id is embedded into the runtime
   * facts the SPA shell boots from.
   * @param request - The request being answered, when available.
   * @returns The UI response.
   */
  async handleUI(request?: Request): Promise<Response> {
    const verified = request && this.#identity ? this.#identity.get(request) : null
    const identity = this.#authorization ? await this.#authorization.resolve(verified) : verified
    const runtime: BasisRuntime = { ...this.runtime, identity }

    return runAsActor({ id: identity }, async () => {
      const resolved = request
        ? await this.#resolveContext(request, identity)
        : { context: {} as AppContext, cookies: [], headers: new Headers() }
      const context = resolved.context
      const component = await this.#loadMain()
      const head: HeadCollector = {}
      const rendered = component
        ? React.createElement(HeadProvider, { collector: head }, React.createElement(component, context))
        : null
      const application = rendered ? renderToString(rendered) : ''
      const title = head.title || this.#title
      const favicon = `<link rel="icon" href="${FAVICON_URL}" />`
      const runtimeScript = [
        '<script id="basis-runtime" type="application/json">',
        serializeBasisRuntime(runtime),
        '</script>',
      ].join('')
      const bootstrapScript = [
        '<script id="basis-bootstrap" type="application/json">',
        serializeBootstrap(context),
        '</script>',
      ].join('')

      if (!this.#server) {
        const fallback = renderToString(React.createElement(IndexHTML, {
          favicon: false,
          runtime,
          scripts: [],
          title,
        }))
        const html = fallback
          .replace('<div id="root"></div>', `<div id="root">${application}</div>`)
          .replace('</head>', `${runtimeScript}${bootstrapScript}</head>`)
        return this.#withContextResponse(new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        }), resolved)
      }

      const response = await Bun.fetch(this.#devShellURL())
      return this.#withContextResponse(new HTMLRewriter()
        .on('title', {
          element: element => { element.setInnerContent(title) },
        })
        .on('head', {
          element: element => { element.append(`${favicon}${runtimeScript}${bootstrapScript}`, { html: true }) },
        })
        .on('#root', {
          element: element => { element.setInnerContent(application, { html: true }) },
        })
        .transform(response), resolved)
    })
  }

  /**
   * Loads the application component from the configured main module.
   * @returns The component, or null when no main was configured.
   */
  async #loadMain(): Promise<React.ComponentType<AppContext> | null> {
    if (!this.#mainPath) return null

    /*
     * A source change can land while a build is running. Never install that
     * build as current; loop until the build version still matches the latest
     * observed source version.
     */
    while (true) {
      const version = this.#mainVersion
      if (this.#mainComponent && this.#mainComponentVersion === version) {
        return this.#mainComponent
      }

      let build = this.#mainBuilds.get(version)
      if (!build) {
        build = this.#buildMain(version)
        this.#mainBuilds.set(version, build)
        void build.finally(() => {
          if (this.#mainBuilds.get(version) === build) this.#mainBuilds.delete(version)
        }).catch(() => undefined)
      }

      let component: React.ComponentType<AppContext>
      try {
        component = await build
      } catch (error) {
        this.#removeSSRVersion(version)
        if (this.#mainVersion !== version) continue
        throw error
      }

      if (this.#mainVersion !== version) {
        this.#removeSSRVersion(version)
        continue
      }

      this.#mainComponent = component
      this.#mainComponentVersion = version
      this.#cleanupSSRArtifacts(version)
      return component
    }
  }

  /**
   * Compile and import one SSR application module version.
   * @param version - The source version snapshot to compile.
   * @returns The exported application component.
   */
  async #buildMain(version: number): Promise<React.ComponentType<AppContext>> {
    if (!this.#mainPath) throw new Error('Basis: main module is not configured')
    const outdir = path.join(this.#root, '.basis', 'ssr', this.#ssrScope, String(version))
    fs.rmSync(outdir, { force: true, recursive: true })
    const result = await Bun.build({
      entrypoints: [this.#mainPath],
      external: ['basis', 'basis/*'],
      format: 'esm',
      naming: 'entry.js',
      outdir,
      packages: 'external',
      sourcemap: 'none',
      target: 'bun',
    })
    if (!result.success) {
      fs.rmSync(outdir, { force: true, recursive: true })
      const details = result.logs.map(log => log.message).join('\n')
      throw new Error(`Basis: server module build failed: ${details}`)
    }

    const module = await import(`${pathToFileURL(path.join(outdir, 'entry.js')).href}?v=${version}`) as {
      Application?: React.ComponentType<AppContext>,
      default?: React.ComponentType<AppContext>,
    }
    const component = module.Application ?? module.default
    if (typeof component !== 'function') {
      throw new Error(`Basis: main module "${this.#mainPath}" must export Application or a default component`)
    }
    return component
  }

  /**
   * Remove one version directory after its build has finished and failed or
   * been superseded.
   * @param version - The source version to remove.
   */
  #removeSSRVersion(version: number): void {
    fs.rmSync(path.join(this.#ssrScopeDir(), String(version)), { force: true, recursive: true })
  }

  /**
   * Remove obsolete version directories while preserving the active version and
   * every build still in flight.
   * @param active - The version now installed as the application component.
   */
  #cleanupSSRArtifacts(active: number): void {
    const directory = this.#ssrScopeDir()
    if (!fs.existsSync(directory)) return

    const keep = new Set<number>([active, ...this.#mainBuilds.keys()])
    for (const entry of fs.readdirSync(directory)) {
      if (!/^\d+$/.test(entry)) continue
      const version = Number(entry)
      if (keep.has(version)) continue
      fs.rmSync(path.join(directory, entry), { force: true, recursive: true })
    }
  }

  /** Remove every server-owned SSR artifact for this server instance. */
  #cleanupSSRArtifactsAll(): void {
    fs.rmSync(this.#ssrScopeDir(), { force: true, recursive: true })
  }

  /**
   * The server-owned SSR artifact directory for this server instance.
   * @returns The absolute scope directory.
   */
  #ssrScopeDir(): string {
    return path.join(this.#root, '.basis', 'ssr', this.#ssrScope)
  }

  /**
   * Watches application source so the server-rendered component is rebuilt on
   * the next request after a source change.
   */
  async #watchMain(): Promise<void> {
    if (!this.#mainPath || this.#watcher) return
    const { watch } = await import('chokidar')
    const watcher = watch(this.#root, {
      ignoreInitial: true,
      ignored: [/(^|[/\\])(?:node_modules|\.basis)([/\\]|$)/],
    })
    this.#watcher = watcher
    watcher.on('all', (_event, filename) => {
      if (!/\.(?:ts|tsx|js|jsx)$/.test(filename)) return
      this.#mainVersion += 1
    })
    await new Promise<void>(resolveReady => watcher.once('ready', () => resolveReady()))
  }

  /**
   * Serve the configured or discovered favicon, when the server owns its bytes.
   * @param uri - The request URI.
   * @returns The favicon response, or `null` to fall through.
   */
  #handleFavIcon(uri: URI): Promise<Response | null> {
    if (!this.#favIcon || uri.path !== this.#favIcon.path) return Promise.resolve(null)
    return favIconResponse(this.#favIcon, uri.query)
  }

  /**
   * Serve a Basis or app icon as standalone SVG at `/icons/{Name}.svg`.
   * @param uri - The request URI.
   * @returns The icon response, or `null` when the path is not an icon.
   */
  #handleIcon(uri: URI): Response | null {
    const name = matchIconPath(uri.path)
    if (!name) return null

    const icon = resolveIcon(name, this.#icons)
    if (!icon) return Server.NotFound
    return iconResponse(icon, {}, uri.query)
  }

  /**
   * Starts the server.
   *
   * Managed deployments inject `VERSION` (the authoritative release version,
   * for example `0.6.1`) and `GIT_SHA` (the exact deployed checkout). This
   * server echoes `VERSION` on `/api/health` and embeds all three platform facts
   * into the SPA shell as client runtime context.
   *
   * Lifecycle output (startup, shutdown, build failures, HMR) is written
   * through the server's {@link Logger}, which picks up `SERVICE_NAME`,
   * `VERSION`, and `GIT_SHA` automatically.
   * @param options - The options to start the server with.
   * @param options.hostname - The interface to bind.
   * @param options.idleTimeout - HTTP idle timeout in seconds (`idleTimeout` for `Bun.serve`).
   * @param options.logger - Log sink for lifecycle output.
   * @param options.port - The port to bind.
   * @param options.version - The release version reported by `/api/health`.
   * @returns The server.
   */
  start = ({
    hostname = Bun.env.HOST ?? '127.0.0.1',
    idleTimeout,
    logger,
    port = Number(Bun.env.PORT ?? 80),
    version = Bun.env.VERSION ?? 'development',
  }: ServerOptions = {}): this => {
    if (logger) this.#logger = logger
    this.#version = version
    this.#favIcon = resolveFavIcon(
      this.#favIconInput,
      this.#favIconOptions,
      process.cwd(),
      this.#root,
      this.#assets ? [this.#assets] : [],
    )

    let databaseOptions: ManagedDatabaseOptions = this.#databaseOptions ?? {}
    if (this.#graph) {
      databaseOptions = {
        ...databaseOptions,
        authorization: true,
        entities: this.#graph.definitions,
      }
    }
    if (this.#databaseOptions || this.#graph) {
      this.#database = createDatabase(databaseOptions)
      if (this.#graph) {
        this.#authorization = new Authorization({
          database: this.#database,
          graph: this.#graph,
        })
      }
    }
    const databaseReady = this.#databaseReady()

    const directory = devShellDirectory(JSON.stringify([this.#root, this.#title, this.#mainPath]))
    const entrypoints = this.#mainPath
      ? [writeHydrationEntry({ directory: path.join(this.#root, '.basis'), mainPath: this.#mainPath })]
      : []
    const shell = writeDevShell({ directory, entrypoints, title: this.#title })
    const routes = {
      [DEV_SHELL_ROUTE]: import.meta.require(shell),
    } as Bun.Serve.Routes<SocketData, string>

    this.#readyError = null
    this.#status = 'starting'
    const watcherReady = this.#watchMain()

    this.#server = Bun.serve({
      development: { hmr: true },
      fetch: this.handle,
      hostname,
      ...(idleTimeout === undefined ? {} : { idleTimeout }),
      port,
      ...(routes === undefined ? {} : { routes }),
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
    } as Bun.Serve.Options<SocketData>)

    process.on('SIGINT', this.#handleSignal)
    process.on('SIGTERM', this.#handleSignal)

    // The Bun dev shell builds lazily; prove one build before reporting healthy.
    this.#warmShell(databaseReady, watcherReady)

    this.#logger.info(`listening http://${this.#server.hostname}:${this.#server.port}`)

    return this
  }

  /**
   * Stops the server, its build watcher, and its database pool.
   *
   * Pool teardown is asynchronous; {@link shutdown} waits for it. This method
   * keeps its synchronous contract for existing callers.
   * @returns The server.
   */
  stop = (): this => {
    process.off('SIGINT', this.#handleSignal)
    process.off('SIGTERM', this.#handleSignal)

    this.#logger.info('stopping')

    void this.#watcher?.close()
    this.#watcher = null

    this.#server?.stop()
    this.#server = null

    if (!this.#closing) {
      const closing = this.#database.close()
      void closing.catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.#logger.error(`database close failed: ${failure.message}`)
      })
      this.#closing = closing
    }

    return this
  }

  /**
   * Stops the server and waits for asynchronous teardown, including the
   * server-owned database pool.
   * @returns A promise that settles when teardown finishes.
   */
  async shutdown(): Promise<void> {
    this.stop()
    await this.#closing
    await Promise.allSettled([...this.#mainBuilds.values()])
    this.#cleanupSSRArtifactsAll()
  }

  /**
   * Shares the identity capability the server uses to verify requests.
   *
   * Once set, every UI request is verified through the capability and the
   * resulting user id (or `null`) is embedded as `runtime.identity`, so a
   * consumer's frontend reads the signed-in identity from its standard runtime
   * context without a fetch of its own.
   * @param identity - The shared identity capability.
   * @returns The server.
   */
  identity(identity: Identity): this {
    this.#identity = identity
    return this
  }

  /**
   * Mounts a provider-agnostic OAuth sign-in flow.
   *
   * Registers `/api/oauth/login`, `/api/oauth/callback`, and
   * `/api/oauth/logout`, and wires the flow's session capability into the
   * server so the signed-in identity is embedded into the SPA runtime context
   * automatically.
   * @param options - Provider seams, the session capability, and policy.
   * @returns The server.
   */
  oauth(options: OAuthOptions): this {
    const provider = options.session.provider
    const resolve = options.identity
    const flow = new OAuth({
      ...options,
      identity: async accessToken => {
        const resolved = await resolve(accessToken)
        if (resolved === null || !this.#authorization) return resolved
        const subject = typeof resolved === 'string' ? resolved : resolved.subject
        const profile: { displayName?: string, email?: string } = {}
        if (typeof resolved !== 'string') {
          if (resolved.displayName !== undefined) profile.displayName = resolved.displayName
          if (resolved.email !== undefined) profile.email = resolved.email
        }
        return this.#authorization.enrollIdentity(provider, subject, profile)
      },
    })
    this.identity(options.session)
    this.api([HttpVerb.Get], 'oauth/login', (_params, { request }) => flow.login(request))
    this.api([HttpVerb.Get], 'oauth/callback', (_params, { request }) => flow.callback(request))
    this.api([HttpVerb.Get], 'oauth/logout', (_params, { request }) => flow.logout(request))
    return this
  }

  /**
   * Configures the canonical application graph and PostgreSQL RLS capability.
   *
   * The graph owns roles and permissions; loading it never mutates PostgreSQL.
   * The database is placed in restricted application-role mode. Bootstrap is
   * explicit through {@link Authorization.bootstrap}; OAuth login never grants
   * administration.
   * @param graph - The application graph.
   * @returns The server.
   */
  graph(graph: Graph): this {
    this.#graph = graph
    return this
  }

  /**
   * Requires the deployed schema to match an approved migration artifact.
   *
   * Readiness runs through the trusted administrative connection at startup and
   * fails closed without applying any migration. {@link DDL.readiness} performs
   * the check; this method only wires it into startup/health.
   * @param artifact - Approved immutable migration artifact.
   * @returns The server.
   */
  migration(artifact: MigrationArtifact): this {
    this.#schemaExpectation = artifact
    return this
  }

  /**
   * Configures the server-owned PostgreSQL capability.
   *
   * The server reconciles its application-scoped managed PostgreSQL service on
   * `start`, discovers its Docker-allocated loopback port, and connects the
   * pool before reporting healthy. The server owns the pool lifecycle; the
   * managed database service outlives it.
   * @param options - Optional image selection for the managed service.
   * @returns The server.
   */
  database(options: DatabaseOptions = {}): this {
    const unsupported = ['adminUrl', 'appRole', 'authorization', 'entities', 'url']
      .filter(key => key in options)
    if (unsupported.length > 0) {
      throw new Error(
        `Server: unsupported database option(s): ${unsupported.join(', ')}. ` +
        'Basis owns its managed PostgreSQL instance; provide the application model through Graph.',
      )
    }
    this.#databaseOptions = options
    return this
  }

  /**
   * Sets the main entrypoint for the server.
   * @param filePath - The path to the entrypoint.
   * @returns The server.
   */
  main(filePath: string): this {
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.#root, filePath)
    this.#checkPath(absolute)

    this.#mainPath = absolute
    this.#mainComponent = null
    return this
  }

  /**
   * Sets the root directory for the server.
   * @param absolutePath - The absolute path to the root directory.
   * @returns The server.
   */
  root(absolutePath: string): this {
    this.#checkPath(absolutePath)
    this.#root = absolutePath
    return this
  }

  /**
   * Sets the SPA document title.
   * @param title - The document title.
   * @returns The server.
   */
  title(title: string): this {
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
    handler: (params: Params, context: RouteContext<AppContext>) => Response | Promise<Response>,
  ): this {
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
  sse<Params extends object = object>(template: string, handler: SseHandler<Params>): this {
    this.#sse.set(template, handler)
    return this
  }

  /**
   * Adds a first-class WebSocket route.
   * @param template - The path template to upgrade, for example `hmr` or `/room/:id`.
   * @param handlers - Lifecycle handlers for connected clients.
   * @returns The server.
   */
  socket(template: string, handlers: SocketHandlers): this {
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
  mount(prefix: string, folder: string, options: { allow?: readonly string[] } = {}): this {
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
  assets(folder: string): this {
    const absolute = path.isAbsolute(folder) ? folder : path.join(this.#root, folder)
    if (!fs.existsSync(absolute)) {
      throw new Error(`Assets folder "${absolute}" does not exist`)
    }

    this.#assets = absolute
    return this
  }

  /**
   * Configures the favicon the server serves at the standard
   * `/assets/favicon` URL.
   *
   * Accepts a path, a file/blob, or a class extending `IconBase`, and sets what
   * that URL returns. A path or file is served verbatim; an icon is rendered as
   * SVG with the given options (and any request query) applied. When no favicon
   * is configured, the server discovers a `favicon.<ext>` in the working
   * directory, the app root, and any assets mount, defaulting to the Basis mark.
   * @param input - The favicon path, file, or icon.
   * @param options - Icon options (`color`, `filled`, `size`, …), for an icon.
   * @returns The server.
   */
  favicon(input: FavIconInput, options: IconOptions = {}): this {
    this.#favIconInput = input
    this.#favIconOptions = options
    return this
  }

  /**
   * Registers app icons for the `/icons/{Name}.svg` route.
   *
   * Registered icons take precedence over Basis's icon set.
   * @param icons - Icon classes, keyed by the name used in the URL.
   * @returns The server.
   */
  icons(icons: IconRegistry): this {
    Object.assign(this.#icons, icons)
    return this
  }

  /**
   * The loopback URL of the generated development shell. Development always
   * binds a locally reachable interface, so the proxy targets loopback.
   * @returns The URL the server proxies UI requests to.
   */
  #devShellURL(): string {
    return `http://127.0.0.1:${this.#server?.port ?? 0}${DEV_SHELL_ROUTE}`
  }

  /**
   * Tracks the combined startup readiness of the build and database.
   * @param readiness - The pending startup work.
   * @returns The tracked readiness promise.
   */
  #trackReady(readiness: Promise<void>): Promise<void> {
    const tracked = readiness
      .then(() => {
        this.#readyError = null
        this.#status = 'ok'
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.#readyError = failure
        this.#status = 'error'
        this.#logger.error(`startup failed: ${failure.message}`)
        throw failure
      })
    // Avoid an unhandled rejection when a caller never awaits `ready()`.
    void tracked.catch(() => undefined)
    return tracked
  }

  /**
   * Build the development shell once so `/api/health` reflects a real build.
   *
   * Development compiles lazily on the first request, so `ready()` and
   * `/api/health` stay `starting` until one build has actually succeeded. A failed
   * build reports `error` rather than a healthy process.
   * @param databaseReady - The pending database startup.
   * @param watcherReady - Resolves when the SSR source watcher is ready.
   */
  #warmShell(databaseReady: Promise<void>, watcherReady: Promise<void>): void {
    const buildReady = Bun.fetch(this.#devShellURL()).then(response => {
      if (!response.ok) throw new Error(`development build failed (${response.status})`)
    })
    const ssrReady = this.#mainPath ? this.#loadMain().then(() => undefined) : Promise.resolve()
    this.#ready = this.#trackReady(
      Promise.all([buildReady, databaseReady, watcherReady, ssrReady]).then(() => undefined),
    )
  }

  /**
   * Connect the database and validate any configured schema expectation.
   * @returns A promise that resolves when the database path is ready.
   */
  #databaseReady(): Promise<void> {
    if (this.#database instanceof NullDatabase) {
      if (this.#schemaExpectation) {
        return Promise.reject(new Error('Schema readiness requires a database'))
      }
      return Promise.resolve()
    }
    return this.#database.connect().then(async () => {
      if (!this.#schemaExpectation) {
        if (this.#graph) {
          throw new Error(
            'Graph-backed production requires an approved migration artifact; ' +
            'install or migrate explicitly with DDL.plan -> DDL.review -> DDL.apply',
          )
        }
        return
      }
      const artifact = this.#schemaExpectation
      if (this.#graph) {
        const expected = this.#graph.physicalSchema(artifact.appRole, artifact.superuser)
        if (physicalHash(expected) !== artifact.targetHash) {
          throw new Error(
            'Approved migration artifact does not match the configured Graph; ' +
            'review and apply a migration for the current Graph',
          )
        }
      }
      const admin = await openAdmin(this.#database)
      try {
        const result = await DDL.readiness(admin.sql, artifact)
        if (!result.ready) {
          throw new Error(`Schema readiness failed: ${result.discrepancies.join('; ')}`)
        }
      } finally {
        await admin.close()
      }
    })
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
   * Keep a long-lived SSE response alive past the HTTP idle timeout.
   *
   * Overridable so a host (or a test) can observe or adjust the transport
   * contract; the default disables the idle timeout for this request only.
   * @param request - The SSE request whose stream should not idle out.
   */
  protected keepSseStreamAlive(request: Request): void {
    this.#server?.timeout(request, 0)
  }

  /**
   * Handles an incoming request across both modes.
   * @param request - The incoming request.
   * @returns The response, or `undefined` when a WebSocket upgrade is handled.
   */
  handle = async (request: Request): Promise<Response | undefined> => {
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
        this.keepSseStreamAlive(request)
      }
      return sse
    }

    const api = await this.handleAPI(uri, request)
    if (api) return api

    const mounted = await this.handleMount(uri)
    if (mounted) return mounted

    const favicon = await this.#handleFavIcon(uri)
    if (favicon) return favicon

    const icon = this.#handleIcon(uri)
    if (icon) return icon

    switch (uri.type) {
      case 'api': return Server.BadRequest
      case 'assets': return this.handleAsset(uri)
      default: return this.handleUI(request)
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
   * The route targets an API URI can match.
   *
   * APIs live exclusively under `/api`; the root is the SPA surface, so an API
   * template never claims a root path.
   * @param uri - The parsed URI.
   * @returns Candidate template targets.
   */
  #targets(uri: URI): string[] {
    return uri.type === 'api' ? [uri.route] : []
  }

  /**
   * The route targets an SSE URI can match.
   *
   * SSE streams are a server facility rather than an API or an SPA route, so
   * both the `/api` form and a root-level route remain available.
   * @param uri - The parsed URI.
   * @returns Candidate template targets.
   */
  #sseTargets(uri: URI): string[] {
    return uri.type === 'api' ? [uri.route] : uri.route ? [] : [uri.type]
  }

  /** Handles process shutdown signals by stopping, closing the pool, and exiting cleanly. */
  #handleSignal = (): void => {
    void this.shutdown().finally(() => process.exit(0))
  }

}

/**
 * Serialize a request context for embedding in the SPA shell.
 * @param value - The context value.
 * @returns Escaped JSON.
 */
function serializeBootstrap(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Distinguish an application context value from a context result wrapper.
 * @param value - Loader return value.
 * @returns Whether the value carries response metadata.
 */
function isContextResult<AppContext extends object>(
  value: AppContext | ContextResult<AppContext>,
): value is ContextResult<AppContext> {
  return typeof value === 'object'
    && value !== null
    && 'context' in value
    && ('headers' in value || 'cookies' in value)
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
