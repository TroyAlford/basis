/**
 * Get a value from an object by a path.
 * @param path the path to get the value from
 * @param from the object to get the value from
 * @param defaultValue the default value to return if the value is undefined
 * @returns the value at the path
 */
export function get<O = unknown, V = unknown>(
  path: string,
  from: O,
  defaultValue?: V,
): V | undefined {
  let value = from
  for (const key of path.split('.')) {
    value = value?.[key]
    if (value === undefined) return defaultValue
  }

  return value as unknown as V
}
