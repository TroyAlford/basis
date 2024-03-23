import * as fs from 'node:fs'
import * as path from 'node:path'
import { Server as BunServer } from 'bun'
import { HttpVerb, parseTemplateURI, parseURI } from '@basis/utilities'
import { renderToReadableStream } from 'react-dom/server'
import React from 'react'
import { IndexHTML } from '@basis/react'
import { URI } from '@basis/utilities/types/URI'
import { APIRoute } from '../types/APIRoute'
import { ping } from '../apis/ping'
import { health } from '../apis/health'

export class Server {
	static BadRequest = new Response(null, { status: 400, statusText: 'Bad Request' })
	static NotFound = new Response(null, { status: 404, statusText: 'Not Found' })

	#apis = new Map<string, APIRoute>()
	#server: BunServer = null

	/** Absolute path to the folder to serve static assets from */
	#assets: string = null

	constructor() {
		this.api([HttpVerb.Get], 'ping', ping)
		this.api([HttpVerb.Get], 'health', health)
	}

	async download(uri: URI) {
		if (!this.#assets) return Server.NotFound

		const asset = Bun.file(path.join(this.#assets, uri.route))
		if (await asset.exists() === false) return Server.NotFound

		const version = asset.lastModified.toString()

		try {
			if (uri.query.has('v', version)) {
				return new Response(asset, {
					headers: { 'Content-Type': asset.type, ETag: version },
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
	async invoke(uri: URI, method: string) {
		for (const [template, { handler, verbs }] of this.#apis.entries()) {
			if (!verbs.has(method as HttpVerb)) continue

			const params = parseTemplateURI(uri.route, template)
			if (!params) continue

			return handler(params)
		}

		return Server.BadRequest
	}
	async ui() {
		const stream = await renderToReadableStream(
			React.createElement(IndexHTML),
			{ bootstrapModules: ['./hydrate.tsx'] },
		)
		return new Response(stream, { headers: { 'Content-Type': 'text/html' } })
	}

	start = ({ port = 80 } = {}) => {
		this.#server = Bun.serve({
			fetch: async (request: Request) => {
				const parsed = parseURI(request.url)

				switch (parsed.type) {
					case 'api': return this.invoke(parsed, request.method)
					case 'assets': return this.download(parsed)
					default: return this.ui()
				}
			},
			port,
		})

		process.on('SIGINT', this.stop)
		process.on('SIGTERM', this.stop)
	}
	stop = () => {
		process.off('SIGINT', this.stop)
		process.off('SIGTERM', this.stop)

		this.#server?.stop()
	}

	api<Params extends object = object>(
		verbs: HttpVerb[],
		template: string,
		handler: (params: Params) => Response
	) {
		this.#apis.set(template, { handler, verbs: new Set(verbs) })
		return this
	}
	assets(absolutePath: string) {
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`Assets folder "${absolutePath}" does not exist`)
		}

		this.#assets = absolutePath
		return this
	}
}