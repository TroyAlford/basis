import { kebabCase } from './kebabCase'

type Value = boolean | number | string
type DataAttributes = Record<`data-${string}`, Value>
type Data = Record<string, Value | (() => Value)>

/**
 * Convert a record of data attributes to a data attributes object
 * @param data the record of data attributes
 * @returns the data attributes object
 */
export const dataAttributes = (data: Data = {}): DataAttributes => (
  Object.entries(data).reduce(
    (attributes, [key, value]) => {
      const attribute = key.replace(/^(?:data-?)?(.*)$/, (_, $1) => `data-${kebabCase($1)}`)
      attributes[attribute] = value instanceof Function ? value() : value

      return attributes
    },
    {} as DataAttributes,
  )
)
