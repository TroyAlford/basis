export function toHaveAttribute(node: HTMLElement, name: string, value: string | RegExp) {
  const actual = node.getAttribute(name)
  const pass = value instanceof RegExp
    ? value.test(actual)
    : actual === value
  return {
    message: () => `expected ${actual} to equal ${value}`,
    pass,
  }
}
