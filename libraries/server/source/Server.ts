import type { Server as BunServer } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { IndexHTML } from '@basis/react/components/IndexHTML/IndexHTML'
import type { URI } from '@basis/utilities'
import { HttpVerb, parseTemplateURI, parseURI } from '@basis/utilities'
import { health } from '../apis/health'
import { ping } from '../apis/ping'
import type { APIRoute } from '../types/APIRoute'
import { Builder } from './Builder'

/** A server for live-compiling, serving, and hot reloading React code from source. */
/* eslint-disable no-console */
/* TODO: add a proper logger */
export class Server {
  static BadRequest: Response = new Response(null, { status: 400, statusText: 'Bad Request' })
  static NotFound: Response = new Response(null, { status: 404, statusText: 'Not Found' })

  #apis = new Map<string, APIRoute>()
  #assets: string = null
  #builder: Builder
  #modules = new Map<string, string>()
  #root: string = process.cwd()
  #scripts: [string, string][] = []
  #server: BunServer = null
  #websockets = new Set<WebSocket>()

  constructor() {
    this.#builder = new Builder({
      onRebuild: () => {
        console.log('[HMR] Rebuild complete')
        const message = JSON.stringify({
          timestamp: Date.now(),
          type: 'hmr',
        })
        this.#websockets.forEach(ws => ws.send(message))
      },
      root: this.#root,
    })

    this.api([HttpVerb.Get], 'health', health)
    this.api([HttpVerb.Get], 'ping', ping)

    // Add HMR client to the build and track it
    const hmrPath = path.join(__dirname, 'hmr.ts')
    this.#scripts.push(['hmr.js', hmrPath])
    this.#builder.add('hmr.js', hmrPath)
  }

  /**
   * Processes an API request.
   * @param uri - The URI to handle.
   * @param method - The HTTP method to handle.
   * @returns The API response.
   */
  async handleAPI(uri: URI, method: string): Promise<Response> {
    for (const [template, { handler, verbs }] of this.#apis.entries()) {
      if (!verbs.has(method as HttpVerb)) continue

      const params = parseTemplateURI(uri.route, template)
      if (!params) continue

      return handler(params)
    }

    return Server.BadRequest
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
   * @param uri - The URI to handle.
   * @returns The module response.
   */
  async handleModule(uri: URI): Promise<Response> {
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
    const built = await this.#builder.getOutputs()
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
      scripts: this.#scripts.map(([name]) => name),
    }))
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }

  /**
   * Starts the server.
   * @param options - The options to start the server with.
   * @param options.port - The port to start the server on.
   * @returns The server.
   */
  start = ({ port = 80 } = {}): Server => {
    this.#server = Bun.serve({
      fetch: async (request: Request) => {
        // Check for WebSocket upgrade requests first
        if (request.headers.get('upgrade') === 'websocket') {
          const upgraded = this.#server.upgrade(request)
          if (!upgraded) {
            return new Response('WebSocket upgrade failed', { status: 400 })
          }
          return undefined // Bun handles the upgrade
        }

        const uri = parseURI(request.url)

        switch (uri.type) {
          case 'api': return this.handleAPI(uri, request.method)
          case 'assets': return this.handleAsset(uri)
          case 'modules': return this.handleModule(uri)
          case 'scripts': return this.handleScripts(uri)
          default: return this.handleUI()
        }
      },
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

    process.on('SIGINT', this.stop)
    process.on('SIGTERM', this.stop)

    return this
  }

  /**
   * Stops the server.
   * @returns The server.
   */
  stop = (): Server => {
    process.off('SIGINT', this.stop)
    process.off('SIGTERM', this.stop)

    this.#builder.stop()
    this.#server?.stop()

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

    // Store the script for potential root changes
    this.#scripts.push(['index.js', absolute])
    this.#builder.add('index.js', absolute)
      .then(builder => builder.initialBuild())
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

    // Create a new builder with the updated root
    this.#builder = new Builder({
      onRebuild: () => {
        console.log('[HMR] Rebuild complete')
        const message = JSON.stringify({ type: 'hmr' })
        this.#websockets.forEach(ws => ws.send(message))
      },
      root: this.#root,
    })

    // Re-add any existing entry points
    if (this.#scripts.length) {
      for (const [name, file] of this.#scripts) {
        this.#builder.add(name, file)
      }
    }

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
}
