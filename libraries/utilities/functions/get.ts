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
  for (const key of path.split('.')) {
    value = value?.[key]
    if (value === undefined) return defaultValue as unknown
  }
  return value as TypeAt<O, P>
}
