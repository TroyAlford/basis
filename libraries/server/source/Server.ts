import type { Server as BunServer, ServerWebSocket } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { IndexHTML } from '../../react/components/IndexHTML/IndexHTML'
import type { URI } from '../../utilities'
import { HttpVerb, parseTemplateURI, parseURI } from '../../utilities'
import type { HealthStatus } from '../apis/health'
import { health } from '../apis/health'
import { ping } from '../apis/ping'
import type { APIRoute } from '../types/APIRoute'
import { Builder } from './Builder'

/** Options for {@link Server.start}. */
export interface ServerOptions {
  /**
   * Run the live-development build/watch/HMR workflow. When `false`, the
   * server builds once, bundles the installed dependency graph, and does not
   * watch, broadcast HMR, or proxy modules through a CDN.
   * Defaults to `NODE_ENV !== 'production'`.
   */
  development?: boolean,
  /** Interface to bind. Defaults to `HOST`, then `127.0.0.1`. */
  hostname?: string,
  /** Port to bind. Defaults to `PORT`, then `80`. Use `0` for an ephemeral port. */
  port?: number,
  /**
   * Release version reported by `/health`. Defaults to `VERSION`, then
   * `development`. Alforge supplies this as the authoritative release version
   * from the strict semver release tag (for example `0.6.1`); the exact
   * deployed checkout is a separate `GIT_SHA`, and `package.json.version` is
   * never the source.
   */
  version?: string,
}

/**
 * A server for building, serving, and (in development) hot reloading React
 * applications.
 *
 * One server supports two explicit modes. Development keeps the live-compile,
 * file-watch, HMR, and module-proxy workflow. Production builds once, bundles
 * the installed dependency graph, serves the SPA and its assets, reports the
 * release version on `/health`, and shuts down gracefully on SIGINT/SIGTERM.
 */
/* eslint-disable no-console */
/* TODO: add a proper logger */
export class Server {
  static BadRequest: Response = new Response(null, { status: 400, statusText: 'Bad Request' })
  static NotFound: Response = new Response(null, { status: 404, statusText: 'Not Found' })

  #apis = new Map<string, APIRoute>()
  #assets: string | null = null
  #builder: Builder | null = null
  #development = true
  #entrypoints: [string, string][] = []
  #modules = new Map<string, string>()
  #ready: Promise<void> = Promise.resolve()
  #readyError: Error | null = null
  #root: string = process.cwd()
  #server: BunServer<undefined> | null = null
  #status: HealthStatus = 'starting'
  #version = 'development'
  #websockets = new Set<ServerWebSocket>()

  constructor() {
    this.api([HttpVerb.Get], 'health', () => this.#health())
    this.api([HttpVerb.Get], 'ping', ping)
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
   * The bound port.
   * @returns The bound port, or `undefined` before starting.
   */
  get port(): number | undefined {
    return this.#server?.port
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
   * @param method - The HTTP method to handle.
   * @returns The API response, or `null` when no template matches.
   */
  async handleAPI(uri: URI, method: string): Promise<Response | null> {
    const targets = uri.type === 'api'
      ? [uri.route]
      : uri.route ? [] : [uri.type]

    for (const target of targets) {
      if (!target) continue

      for (const [template, { handler, verbs }] of this.#apis.entries()) {
        if (!verbs.has(method as HttpVerb)) continue

        const params = parseTemplateURI(target, template)
        if (!params) continue

        return handler(params)
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
      development: this.#development,
      scripts: this.#scriptNames(),
    }))
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }

  /**
   * Starts the server.
   *
   * Managed deployments inject `VERSION` (the authoritative release version,
   * for example `0.6.1`) and `GIT_SHA` (the exact deployed checkout). This
   * server echoes `VERSION` on `/health`; `GIT_SHA` stays provenance supplied
   * by command-center.
   * @param options - The options to start the server with.
   * @param options.development - Whether to run the development workflow.
   * @param options.hostname - The interface to bind.
   * @param options.port - The port to bind.
   * @param options.version - The release version reported by `/health`.
   * @returns The server.
   */
  start = ({
    development = Bun.env.NODE_ENV !== 'production',
    hostname = Bun.env.HOST ?? '127.0.0.1',
    port = Number(Bun.env.PORT ?? 80),
    version = Bun.env.VERSION ?? 'development',
  }: ServerOptions = {}): Server => {
    this.#development = development
    this.#version = version

    const builder = new Builder({
      development,
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
        throw failure
      })
    // Avoid an unhandled rejection when a caller never awaits `ready()`.
    void this.#ready.catch(() => undefined)

    if (development) {
      this.#server = Bun.serve({
        development,
        fetch: this.#handleRequest,
        hostname,
        port,
        websocket: {
          close: ws => {
            console.log('[WS] Client disconnected')
            this.#websockets.delete(ws)
          },
          message: (ws, message) => {
            console.log('[WS] Received message:', message)
          },
          open: ws => {
            console.log('[WS] Client connected')
            this.#websockets.add(ws)
          },
        },
      })
    } else {
      this.#server = Bun.serve({
        development,
        fetch: this.#handleRequest,
        hostname,
        port,
      })
    }

    process.on('SIGINT', this.#handleSignal)
    process.on('SIGTERM', this.#handleSignal)

    return this
  }

  /**
   * Stops the server and its build watcher.
   * @returns The server.
   */
  stop = (): Server => {
    process.off('SIGINT', this.#handleSignal)
    process.off('SIGTERM', this.#handleSignal)

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
    handler: (params: Params) => Response,
  ): Server {
    this.#apis.set(template, { handler, verbs: new Set(verbs) })
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

    console.log('[HMR] Rebuild complete')
    const message = JSON.stringify({ timestamp: Date.now(), type: 'hmr' })
    this.#websockets.forEach(ws => ws.send(message))
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
    // WebSocket upgrades back the development HMR client only.
    if (this.#development && request.headers.get('upgrade') === 'websocket') {
      const upgraded = this.#server?.upgrade(request)
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined // Bun handles the upgrade
    }

    const uri = parseURI(request.url)

    const api = await this.handleAPI(uri, request.method)
    if (api) return api

    switch (uri.type) {
      case 'api': return Server.BadRequest
      case 'assets': return this.handleAsset(uri)
      case 'modules': return this.handleModule(uri)
      case 'scripts': return this.handleScripts(uri)
      default: return this.handleUI()
    }
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
