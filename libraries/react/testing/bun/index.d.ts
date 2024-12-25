declare module 'bun:test' {
  interface Matchers {
    toHaveAttribute(name: string, value?: string | RegExp): void,
    toHaveClass(...classes: string[]): void,
    toHaveStyle(style: string | RegExp | Partial<CSSStyleDeclaration>): void,
    toHaveTextContent(text: string | RegExp): void,
  }
}
