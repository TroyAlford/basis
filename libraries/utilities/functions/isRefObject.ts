import type { RefObject } from 'react'
import { isNil } from './isNil'

/**
 * Type guard to check if an object is a reference object.
 * @param object - The object to check.
 * @returns True if the object is a reference object.
 */
export function isRefObject(object: RefObject<unknown>): object is RefObject<unknown> {
  return !isNil(object?.current)
}
