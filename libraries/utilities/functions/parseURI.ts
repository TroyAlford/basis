import { URI } from '../types/URI'

export function parseURI(unparsed: string): URI {
	const url = new URL(unparsed)
	const [type, ...rest] = url.pathname.split('/').filter(Boolean)
	return {
		path: url.pathname,
		query: new URLSearchParams(url.search),
		route: rest.join('/'),
		toString() { return [this.path, this.query.toString()].filter(Boolean).join('?') },
		type,
	}
}