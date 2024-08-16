export function toHaveClass(node: HTMLElement, ...classes: string[]) {
	return {
		message: () => `expected ${node.className} to include ${classes.join(' ')}`,
		pass: classes.every(className => node.classList.contains(className)),
	}
}
