/**
 * Sorts an array by the result of a function applied to each element.
 * @param array The array to sort.
 * @param iteratee The function to apply to each element to get the sort key.
 * @returns A new sorted array.
 * @example
 * ```ts
 * const users = [
 *   { name: 'John', age: 30 },
 *   { name: 'Jane', age: 25 },
 *   { name: 'Bob', age: 35 }
 * ]
 *
 * sortBy(users, user => user.age)
 * // [{ name: 'Jane', age: 25 }, { name: 'John', age: 30 }, { name: 'Bob', age: 35 }]
 *
 * sortBy(users, user => user.name)
 * // [{ name: 'Bob', age: 35 }, { name: 'Jane', age: 25 }, { name: 'John', age: 30 }]
 * ```
 */
export const sortBy = <T>(
  array: readonly T[],
  iteratee: (item: T) => string | number | boolean | Date,
): T[] => [...array].sort((a, b) => {
  const aValue = iteratee(a)
  const bValue = iteratee(b)

  if (aValue < bValue) return -1
  if (aValue > bValue) return 1
  return 0
})
