/**
 * Check if a node has a class
 * @param node the node to check
 * @param classes the classes to check for
 * @returns the result of the check
 */
export function toHaveClass(node: HTMLElement, ...classes: string[]) {
  return {
    message: () => `expected ${node.className} to include ${classes.join(' ')}`,
    pass: classes.every(className => node.classList.contains(className)),
  }
}
