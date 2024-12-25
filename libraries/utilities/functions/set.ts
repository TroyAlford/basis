/**
 * Sets a value at a path on an object
 * @param path the path to set the value at
 * @param object the object to set the value on
 * @param value the value to set
 * @returns the object with the value set
 */
export function set<V = object>(path: string, object: V, value: unknown): V {
  const keys = path.split('.')

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
