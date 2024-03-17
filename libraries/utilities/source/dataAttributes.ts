import { kebabCase } from "./kebabCase"

type Value = boolean | number | string
type DataAttributes = {
	[key: `data-${string}`]: Value
}

export const dataAttributes = (
	data: Record<string, Value | (() => Value)> = {}
): DataAttributes => (
	Object.entries(data).reduce((attributes, [key, value]) => {
		const attribute = key.replace(/^(data-?)?(.*)$/, (_, __, $2) => `data-${kebabCase($2)}`)
		attributes[attribute] = value instanceof Function ? value() : value

		return attributes
	}, {} as DataAttributes)
)