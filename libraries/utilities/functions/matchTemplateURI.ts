import { parseTemplateURI } from './parseTemplateURI'

export const matchTemplateURI = (uri: string, templates: Iterable<string>): string | undefined => {
	for (const template of templates) {
		const params = parseTemplateURI(uri, template)
		if (params) return template
	}
	return undefined
}