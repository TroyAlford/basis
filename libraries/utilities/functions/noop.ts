/**
 * A "no operation" function. It does nothing and returns nothing.
 * This function is useful as a default function parameter value.
 * @example
 * function foo(callback: () => void = noop) {
 *   callback() // no need to check if callback is undefined
 * }
 */
export function noop(): void | Promise<void> {
  return
}
