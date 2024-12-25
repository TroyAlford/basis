/**
 * Prefixes an object's keys with a given prefix
 * @param prefix The prefix to add
 * @param input The object to prefix
 * @returns A new object with prefixed keys
 */
export function prefixObject(prefix: string, input: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(input).reduce((output, [key, value]) => ({
    ...output,
    [key.startsWith(prefix) ? key : `${prefix}${key}`]: value,
  }), {})
}
