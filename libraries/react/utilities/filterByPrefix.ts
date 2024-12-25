import { kebabCase } from '@basis/utilities/functions/kebabCase'

/**
 * Filters an object's properties by prefix, removing the prefix and kebab-casing the remaining key
 * @param prefix The prefix to filter by (e.g., 'aria-' or 'data-')
 * @param input The object to filter
 * @returns A new object with filtered and transformed keys
 */
export function filterByPrefix(prefix: string, input: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(input).reduce((output, [key, value]) => {
    if (!key.startsWith(prefix)) return output
    return ({ ...output, [kebabCase(key.slice(prefix.length))]: value })
  }, {})
}
