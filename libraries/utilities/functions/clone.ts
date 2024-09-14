import { get } from './get'
import { set } from './set'

/**
 * Clone an object.
 * @param value the value to clone
 * @returns the cloned value
 */
export function clone<V = object>(value: V): V {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(item => clone(item)) as V
  if (value instanceof Date) return new Date(value.getTime()) as V
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as V

  const queue: { path: string, source: unknown, target: unknown }[] = []
  const cloned = {} as V
  queue.push({ path: '', source: value, target: cloned })

  while (queue.length > 0) {
    const { path, source } = queue.shift()

    Object.keys(source).forEach(key => {
      const fullPath = path ? `${path}.${key}` : key
      const item = get(fullPath, value)

      if (typeof item === 'object' && item !== null) {
        if (item instanceof Date) {
          set(fullPath, cloned, new Date(item.getTime()))
        } else if (item instanceof RegExp) {
          set(fullPath, cloned, new RegExp(item.source, item.flags))
        } else {
          set(fullPath, cloned, Array.isArray(item) ? [] : {})
          queue.push({ path: fullPath, source: item, target: get(fullPath, cloned) })
        }
      } else {
        set(fullPath, cloned, item)
      }
    })
  }

  return cloned
}
