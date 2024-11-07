import type { FilterOptions } from '../types/FilterOptions'

/**
 * Filters an array of items by inclusion and exclusion patterns.
 * @param items - The array of items to filter.
 * @param options - Filter options containing 'only' and 'not' patterns.
 * @returns The filtered array of items.
 */
export function filterByPatterns(items: string[], options: FilterOptions): string[] {
  let filtered = items

  // Apply inclusion patterns if any
  if (options.only?.length) {
    const includePatterns = options.only.map(pattern => new RegExp(pattern))
    filtered = filtered.filter(item => includePatterns.some(pattern => pattern.test(item)))
  }

  // Apply exclusion patterns if any
  if (options.not?.length) {
    const excludePatterns = options.not.map(pattern => new RegExp(pattern))
    filtered = filtered.filter(item => !excludePatterns.some(pattern => pattern.test(item)))
  }

  return filtered.sort()
}
