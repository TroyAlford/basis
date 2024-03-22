import * as path from 'node:path'
import * as fs from 'node:fs'
import React from 'react'
import { Server as BunServer } from 'bun'
import { renderToReadableStream } from 'react-dom/server'
import { HttpVerb, parseTemplateURI } from '@basis/utilities'
import { IndexHTML } from '@basis/react'

export type APIRoute<Params extends object = object> = {
	handler: (params: Params) => Response,
	verbs: Set<HttpVerb>,
}

export type URI = {
	/**
	 * Requested resource path, without the origin
	 * @example /api/foo/bar
	 * @example /assets/foo/bar
	 */
	path: string,
	/**
	 * Requested query parameters
	 * @example ?foo=bar -> { foo: 'bar' }
	 * @example ?foo=bar&baz=qux -> { foo: 'bar', baz: 'qux' }
	 */
	query: URLSearchParams,
	/**
	 * Requested resource with the type prefix removed
	 * @example /api/foo/bar -> foo/bar
	 * @example /assets/foo/bar -> foo/bar
	 */
	route: string,
	/**
	 * Requested resource type prefix
	 * @example /api/foo/bar -> api
	 * @example /assets/foo/bar -> assets
	 */
	type: string,
	/**
	 * Full URL
	 * @example /api/foo/bar?baz=qux
	 */
	toString(): string,
}

export class Server {
	static BadRequest = new Response(null, { status: 400, statusText: 'Bad Request' })
	static NotFound = new Response(null, { status: 404, statusText: 'Not Found' })

	#apis = new Map<string, APIRoute>()
	#server: BunServer = null

	/** Absolute path to the folder to serve static assets from */
	#assets: string = null

	parse(unparsed: string): URI {
		const url = new URL(unparsed)
		const [type, ...rest] = url.pathname.split('/').filter(Boolean)
		return {
			path: url.pathname,
			query: new URLSearchParams(url.search),
			route: rest.join('/'),
			toString() { return `${this.path}?${this.query}` },
			type,
		}
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
				const parsed = this.parse(request.url)

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
