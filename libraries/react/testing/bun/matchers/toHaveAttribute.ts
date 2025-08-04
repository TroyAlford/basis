interface ReturnType { message: () => string, pass: boolean }

/**
 * Check if an element has an attribute with a specific value.
 * @param node the node to check
 * @param name the name of the attribute
 * @param value the value of the attribute
 * @returns the result of the check
 */
export function toHaveAttribute(
  node: HTMLElement | null,
  name: string,
  value?: string | RegExp,
): ReturnType {
  if (!node) {
    return {
      message: () => 'expected element to exist but received null',
      pass: false,
    }
  }

  const actual = node.getAttribute(name)
  let message = ''
  let pass = false

  if (value === undefined) {
    message = `expected element to have attribute ${name}`
    pass = actual !== null
  } else if (value instanceof RegExp) {
    message = `expected ${actual} to equal ${value}`
    pass = value.test(actual)
  } else {
    message = `expected ${actual} to equal ${value}`
    pass = actual === value
  }

  return { message: () => message, pass }
}
