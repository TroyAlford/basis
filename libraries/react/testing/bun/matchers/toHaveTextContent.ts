/**
 * Check if an element contains specific text content.
 * @param node the node to check
 * @param text the text content to check for
 * @returns the result of the check
 */
export function toHaveTextContent(node: HTMLElement, text: string | RegExp) {
  const actual = node.textContent || ''
  const pass = text instanceof RegExp ? text.test(actual) : actual.includes(text)
  return {
    message: () => `expected ${actual} to include ${text}`,
    pass,
  }
}
