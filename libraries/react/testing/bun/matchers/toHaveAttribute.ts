interface ReturnType { message: () => string, pass: boolean }

/**
 * Check if an element has an attribute with a specific value.
 * @param node the node to check
 * @param name the name of the attribute
 * @param value the value of the attribute
 * @returns the result of the check
 */
export function toHaveAttribute(
  node: HTMLElement,
  name: string,
  value?: string | RegExp,
): ReturnType {
  const actual = node.getAttribute(name)
  const pass = value === undefined
    ? actual !== null
    : value instanceof RegExp
      ? value.test(actual)
      : actual === value
  return {
    message: () => (value === undefined
      ? `expected element to have attribute ${name}`
      : `expected ${actual} to equal ${value}`),
    pass,
  }
}
