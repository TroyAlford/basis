import type { PathOf } from '../types/PathOf'
import type { TypeAt } from '../types/TypeAt'

/**
 * Sets a value at a path on an object
 * @param object the object to set the value on
 * @param path the path to set the value at
 * @param value the value to set
 * @returns the object with the value set
 */
export function set<V = object, P extends PathOf<V> = PathOf<V>>(
  object: V,
  path: P,
  value: TypeAt<V, P>,
): V {
  const keys = String(path).split('.')

  let current = object
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value
    } else if (current[key] === undefined) {
      current[key] = {}
    }

    current = current[key]
  })

  return object
}
