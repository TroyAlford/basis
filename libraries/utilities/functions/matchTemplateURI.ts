import { parseTemplateURI } from './parseTemplateURI'

/**
 * Match a URI with a template
 * @param uri the URI to match
 * @param templates the templates to match against
 * @returns the matched template
 */
export const matchTemplateURI = (uri: string, templates: Iterable<string>): string | undefined => {
  for (const template of templates) {
    const params = parseTemplateURI(uri, template)
    if (params) return template
  }
  return undefined
}
