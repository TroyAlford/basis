import { clone } from './clone'
import { isNil } from './isNil'

/**
 * Merge multiple objects together, with later arguments taking precedence.
 * If a node in a later object has a different type than the corresponding node
 * in an earlier object, it replaces it. If the types match and are both objects,
 * they are merged recursively.
 * @param first The first object to merge
 * @param objects The objects to merge
 * @returns The merged object
 * @example
 * merge(
 *   { foo: { bar: 'bar', baz: 'baz' } },
 *   { foo: { bar: 'qux', qux: 'quux' } }
 * )
 * // returns { foo: { bar: 'qux', baz: 'baz', qux: 'quux' } }
 *
 * merge(
 *   { foo: { bar: 'bar' } },
 *   { foo: 'bar' }
 * )
 * // returns { foo: 'bar' } - different types, so second value replaces first
 */
export function merge<T = object>(first: T, ...objects: T[]): T {
  const output = isNil(first) ? {} : clone(first)
  if (objects.length === 0) return output as T

  return objects.reduce<T>((result, next) => mergeObjects(result, next) as T, output as T)
}

/**
 * Check if a value is an object.
 * @param value The value to check
 * @returns Whether the value is an object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge two objects together, with the second object taking precedence.
 * If a node in the second object has a different type than the corresponding
 * node in the first object, it replaces it. If the types match and are both
 * objects, they are merged recursively.
 * @param target The target object
 * @param source The source object
 * @returns The merged object
 */
function mergeObjects(target: unknown, source: unknown): unknown {
  // If either isn't an object, or they're different types, source wins
  if (!isObject(target) || !isObject(source) || Array.isArray(target) !== Array.isArray(source)) {
    return source
  }

  const result = { ...target }
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key]

    // If key doesn't exist in target, or types don't match, use source value
    if (!(key in target) || typeof sourceValue !== typeof targetValue) {
      result[key] = sourceValue
      continue
    }

    // If both values are objects, merge them recursively
    if (isObject(targetValue) && isObject(sourceValue)) {
      result[key] = mergeObjects(targetValue, sourceValue)
      continue
    }

    // Otherwise use source value
    result[key] = sourceValue
  }

  return result
}
