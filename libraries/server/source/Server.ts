import type { Server as BunServer } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { IndexHTML } from '@basis/react'
import { HttpVerb, parseTemplateURI, parseURI } from '@basis/utilities'
import type { URI } from '@basis/utilities/types/URI'
import { health } from '../apis/health'
import { ping } from '../apis/ping'
import type { APIRoute } from '../types/APIRoute'
import { Builder } from './Builder'

/* eslint-disable no-console */
/* TODO: add a proper logger */
export class Server {
  static BadRequest = new Response(null, { status: 400, statusText: 'Bad Request' })
  static NotFound = new Response(null, { status: 404, statusText: 'Not Found' })

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

  async handleAPI(uri: URI, method: string) {
    for (const [template, { handler, verbs }] of this.#apis.entries()) {
      if (!verbs.has(method as HttpVerb)) continue

      const params = parseTemplateURI(uri.route, template)
      if (!params) continue

      return handler(params)
    }

    return Server.BadRequest
  }
  async handleAsset(uri: URI) {
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
  async handleModule(uri: URI) {
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
  async handleScripts(uri: URI) {
    const built = await this.#builder.getOutputs()
    const script = built.find(s => s.name === uri.route)
    if (!script) return Server.NotFound

    return new Response(await script.output.text(), {
      headers: { 'Content-Type': script.output.type },
      status: 200,
      statusText: 'OK',
    })
  }
  async handleUI() {
    const html = await renderToString(React.createElement(IndexHTML, {
      scripts: this.#scripts.map(([name]) => name),
    }))
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }

  start = ({ port = 80 } = {}) => {
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
  stop = () => {
    process.off('SIGINT', this.stop)
    process.off('SIGTERM', this.stop)

    this.#builder.stop()
    this.#server?.stop()

    return this
  }

  main(filePath: string) {
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
  root(absolutePath: string) {
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
  #checkPath(absolutePath: string) {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Path "${absolutePath}" does not exist`)
    }
  }

  api<Params extends object = object>(
    verbs: HttpVerb[],
    template: string,
    handler: (params: Params) => Response,
  ) {
    this.#apis.set(template, { handler, verbs: new Set(verbs) })
    return this
  }
  assets(folder: string) {
    const absolute = path.isAbsolute(folder) ? folder : path.join(this.#root, folder)
    if (!fs.existsSync(absolute)) {
      throw new Error(`Assets folder "${absolute}" does not exist`)
    }

    this.#assets = absolute
    return this
  }
}
