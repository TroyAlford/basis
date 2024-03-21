export const parseURI = <Token extends string = string>(
	uri: string,
	template: string,
): Record<Token, string> => {
	const [templatePath, templateQuery] = template.split('?')
	const [uriPath, uriQuery] = uri.split('?')
	const regex = new RegExp(`^${templatePath.replace(/:([a-z]*)/gi, '(?<$1>[^/]+)')}$`)

	const pathMatch = uriPath.match(regex)
	if (!pathMatch) return null

	const uriQueryParams = new URLSearchParams(uriQuery)
	const parsed = {
		...Object.fromEntries(uriQueryParams.entries()),
		...pathMatch.groups ?? {},
	} as Record<Token, string>

	if (templateQuery) {
		if (!uriQuery) return null

		const templateQueryParams = new URLSearchParams(templateQuery)
		for (const [key, value] of templateQueryParams) {
			if (!uriQueryParams.has(key)) return null
			if (value !== '*' && uriQueryParams.get(key) !== value) return null
		}
	}

	return parsed
}