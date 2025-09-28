import type { PathOf } from '../types/PathOf'
import type { TypeAt } from '../types/TypeAt'

/**
 * Get a value from an object by a path.
 * @param from the object to get the value from
 * @param path the path to get the value from
 * @returns the value at the path
 */
export function get<O, P extends PathOf<O> = PathOf<O>>(from: O, path: P): TypeAt<O, P> | undefined

/**
 * Get a value from an object by a path.
 * @param from the object to get the value from
 * @param path the path to get the value from
 * @param defaultValue the default value to return if the value is undefined
 * @returns the value at the path
 */
export function get<O, P extends PathOf<O>>(from: O, path: P, defaultValue: TypeAt<O, P>): TypeAt<O, P>

export function get<O, P extends PathOf<O>>(from: O, path: P, defaultValue?: TypeAt<O, P>) {
  let value: unknown = from
  const parts = path.split('.')
  let i = 0

  while (i < parts.length) {
    // Try progressively longer literal keys from current position
    let foundLiteral = false
    for (let j = parts.length; j > i; j--) {
      const literalKey = parts.slice(i, j).join('.')
      if (value && typeof value === 'object' && literalKey in value) {
        value = (value as unknown)[literalKey]
        i = j // Skip the parts we just consumed
        foundLiteral = true
        break
      }
    }

    // If no literal key was found, try the current part
    if (!foundLiteral && i < parts.length) {
      const currentPart = parts[i]
      value = value?.[currentPart]
      if (value === undefined) return defaultValue as unknown
      i++
    }
  }

  return value as TypeAt<O, P>
}
