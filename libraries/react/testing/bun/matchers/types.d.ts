import type { Mock } from 'bun:test'

declare global {
  namespace jest {
    interface Matchers<R> {
      toRaise(mock: Mock<(...args: unknown[]) => void>, ...expectedArgs: unknown[]): R,
    }
  }
}

export { }
