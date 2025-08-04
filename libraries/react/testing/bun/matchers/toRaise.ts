// libraries/react/testing/bun/matchers/simulate-assertions.ts
import type { Mock } from 'bun:test'

/**
 * Custom matcher to check if a mock was called
 * Usage: expect(Simulate.change(input, 'value')).toRaise(onChange)
 * Usage: expect(Simulate.change(input, 'value')).toRaise(onChange, 'arg1')
 * Usage: expect(Simulate.change(input, 'value')).toRaise(onChange, 'arg1', 'arg2')
 * @param _ the received value (unused)
 * @param mock the mock to check
 * @param expectedArgs the expected arguments
 * @returns the result of the check
 */
export function toRaise(_: unknown, mock: Mock<(...args: unknown[]) => void>, ...expectedArgs: unknown[]) {
  if (typeof mock !== 'function' || !('mock' in mock)) {
    throw new Error('toRaise: second argument must be a bun:test Mock or Spy function')
  }

  const calls = mock.mock.calls
  const hasCall = calls.length > 0

  // If no expected args, just check if mock was called
  if (expectedArgs.length === 0) {
    return {
      message: () => 'Expected mock to be called, but it was not called.',
      pass: hasCall,
    }
  }

  // If expected args provided, check if mock was called with matching args
  if (!hasCall) {
    return {
      message: () => `Expected mock to be called with ${JSON.stringify(expectedArgs)}, but it was not called.`,
      pass: false,
    }
  }

  // Check if any call matches the expected arguments (currying behavior)
  const matchingCall = calls.find(call => {
    // Check that call has at least as many args as expected
    if (call.length < expectedArgs.length) return false

    // Check that the first N args match (where N is the number of expected args)
    return expectedArgs.every((expected, index) => {
      const actual = call[index]
      // Use JSON.stringify for deep comparison
      return JSON.stringify(actual) === JSON.stringify(expected)
    })
  })

  if (!matchingCall) {
    const lastCall = calls[calls.length - 1]?.map(arg => (
      typeof arg === 'object' && arg !== null ? '[Object]' : String(arg)
    )).join(', ')
    const expectedStr = JSON.stringify(expectedArgs)
    return {
      message: () => `Expected mock to be called with ${expectedStr}, but it was called with ${lastCall}.`,
      pass: false,
    }
  }

  return {
    message: () => `Expected mock not to be called with ${JSON.stringify(expectedArgs)}, but it was.`,
    pass: true,
  }
}
