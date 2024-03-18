declare module 'bun:test' {
	interface Matchers {
		toHaveAttribute(name: string, value: string | RegExp): void,
		toHaveClass(...classes: string[]): void,
	}
}