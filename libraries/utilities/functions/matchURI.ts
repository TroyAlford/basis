import { parseURI } from './parseURI'

export const matchURI = (uri: string, templates: Iterable<string>): string | undefined => {
	for (const template of templates) {
		const params = parseURI(uri, template)
		if (params) return template
	}
	return undefined
}