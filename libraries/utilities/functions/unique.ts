import { deepEquals } from './deepEquals'
import { get } from './get'

export type UniquePredicate<T> = (item: T, included: readonly T[]) => boolean

/**
 * Returns a new array with duplicates removed, preserving the first occurrence order.
 * @param items the items to de-duplicate
 * @param predicate controls what counts as a duplicate (defaults to scalar Set-based)
 * @returns a new array with unique items
 */
export function unique<T>(items: readonly T[], predicate: UniquePredicate<T> = unique.scalars()): T[] {
  return items.reduce<T[]>((out, item) => {
    if (predicate(item, out)) out.push(item)
    return out
  }, [])
}

unique.scalars = <T, K = T>(keyOf: (item: T) => K = item => item as unknown as K): UniquePredicate<T> => {
  const seen = new Set<K>()
  return (item): boolean => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

unique.by = <T, P extends string>(path: P): UniquePredicate<T> => unique.scalars(item => {
  if (item === null || item === undefined) return item
  if (typeof item !== 'object') return undefined
  return get(item as unknown as Record<string, unknown>, path as never)
})

unique.deepEquals = <T>(item: T, included: readonly T[]): boolean => (
  !included.some(existing => deepEquals(existing, item))
)
