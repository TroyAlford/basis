import { parseURI } from './parseURI'

export const matchURI = (uri: string, templates: string[]): string | undefined => (
	templates.find(template => parseURI(uri, template) !== null)
)