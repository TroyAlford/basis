import { kebabCase } from './kebabCase'

type Value = boolean | number | string
type DataAttributes = Record<`data-${string}`, Value>;

export const dataAttributes = (
	data: Record<string, Value | (() => Value)> = {},
): DataAttributes => (
	Object.entries(data).reduce((attributes, [key, value]) => {
		const attribute = key.replace(/^(?:data-?)?(.*)$/, (_, $1) => `data-${kebabCase($1)}`)
		attributes[attribute] = value instanceof Function ? value() : value

		return attributes
	}, {} as DataAttributes)
)
