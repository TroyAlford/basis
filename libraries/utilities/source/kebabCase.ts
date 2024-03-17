import { deburr } from './deburr'

export const kebabCase = (input: string): string => (
	deburr(input)
		.replace(/([^\w]|[\s_])+/g, '-') // Replace non-word characters with hyphens
		.replace(/([a-z])([A-Z])/g, '$1-$2') // Insert hyphens between camelCase words
		.toLowerCase() // Convert to lowercase
)