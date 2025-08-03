import type { Mock } from 'bun:test'
import { describe, expect, mock, test } from 'bun:test'
import { Simulate } from '../../Simulate'
import { toRaise } from './toRaise'

describe('toRaise matcher', () => {
  describe('basic functionality', () => {
    test('passes when mock was called', () => {
      const mockFn = mock()
      mockFn('test')
      const result = toRaise(undefined, mockFn)
      expect(result.pass).toBe(true)
    })

    test('fails when mock was not called', () => {
      const mockFn = mock()
      const result = toRaise(undefined, mockFn)
      expect(result.pass).toBe(false)
      expect(result.message()).toBe('Expected mock to be called, but it was not called.')
    })

    test('throws when second argument is not a mock', () => {
      const regularFn = () => { /* empty function */ }
      expect(() => toRaise(undefined, regularFn as unknown as Mock<(...args: unknown[]) => void>))
        .toThrow('toRaise: second argument must be a bun:test Mock or Spy function')
    })
  })

  describe('currying behavior', () => {
    test('matches first argument only', () => {
      const mockFn = mock()
      mockFn('correct', 'ignored', 'ignored')

      const result = toRaise(undefined, mockFn, 'correct')
      expect(result.pass).toBe(true)
    })

    test('matches first two arguments', () => {
      const mockFn = mock()
      mockFn('correct', 'also-correct', 'ignored')

      const result = toRaise(undefined, mockFn, 'correct', 'also-correct')
      expect(result.pass).toBe(true)
    })

    test('fails when first argument does not match', () => {
      const mockFn = mock()
      mockFn('wrong', 'correct')

      const result = toRaise(undefined, mockFn, 'correct')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["correct"]')
    })

    test('fails when second argument does not match', () => {
      const mockFn = mock()
      mockFn('correct', 'wrong')

      const result = toRaise(undefined, mockFn, 'correct', 'correct')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["correct","correct"]')
    })

    test('fails when mock has fewer arguments than expected', () => {
      const mockFn = mock()
      mockFn('correct') // Only one arg, but we expect two

      const result = toRaise(undefined, mockFn, 'correct', 'missing')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["correct","missing"]')
    })

    test('finds matching call among multiple calls', () => {
      const mockFn = mock()
      mockFn('wrong', 'wrong')
      mockFn('correct', 'also-correct')
      mockFn('wrong', 'wrong')

      const result = toRaise(undefined, mockFn, 'correct', 'also-correct')
      expect(result.pass).toBe(true)
    })

    test('fails when no call matches among multiple calls', () => {
      const mockFn = mock()
      mockFn('wrong1', 'wrong1')
      mockFn('wrong2', 'wrong2')

      const result = toRaise(undefined, mockFn, 'correct', 'correct')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["correct","correct"]')
    })
  })

  describe('complex object matching', () => {
    test('matches objects with same structure', () => {
      const mockFn = mock()
      const expectedObj = { id: 1, name: 'test' }
      mockFn(expectedObj)

      const result = toRaise(undefined, mockFn, expectedObj)
      expect(result.pass).toBe(true)
    })

    test('fails when objects have different values', () => {
      const mockFn = mock()
      const actualObj = { id: 1, name: 'actual' }
      const expectedObj = { id: 1, name: 'expected' }
      mockFn(actualObj)

      const result = toRaise(undefined, mockFn, expectedObj)
      expect(result.pass).toBe(false)
    })

    test('matches arrays with same content', () => {
      const mockFn = mock()
      const expectedArray = [1, 2, 3]
      mockFn(expectedArray)

      const result = toRaise(undefined, mockFn, expectedArray)
      expect(result.pass).toBe(true)
    })

    test('fails when arrays have different content', () => {
      const mockFn = mock()
      const actualArray = [1, 2, 3]
      const expectedArray = [1, 2, 4]
      mockFn(actualArray)

      const result = toRaise(undefined, mockFn, expectedArray)
      expect(result.pass).toBe(false)
    })
  })

  describe('edge cases', () => {
    test('handles null and undefined arguments', () => {
      const mockFn = mock()
      mockFn(null, undefined)

      const result = toRaise(undefined, mockFn, null, undefined)
      expect(result.pass).toBe(true)
    })

    test('handles empty string arguments', () => {
      const mockFn = mock()
      mockFn('', 'not-empty')

      const result = toRaise(undefined, mockFn, '', 'not-empty')
      expect(result.pass).toBe(true)
    })

    test('handles zero and falsy values', () => {
      const mockFn = mock()
      mockFn(0, false, '')

      const result = toRaise(undefined, mockFn, 0, false, '')
      expect(result.pass).toBe(true)
    })

    test('fails when mock was called but with no arguments', () => {
      const mockFn = mock()
      mockFn() // Called with no args

      const result = toRaise(undefined, mockFn, 'expected')
      expect(result.pass).toBe(false)
    })
  })

  describe('error message clarity', () => {
    test('shows expected vs actual when mock was called with wrong args', () => {
      const mockFn = mock()
      mockFn('actual', 'args')

      const result = toRaise(undefined, mockFn, 'expected', 'args')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["expected","args"]')
      expect(result.message()).toContain('but it was called with actual, args')
    })

    test('shows clear message when mock was not called', () => {
      const mockFn = mock()

      const result = toRaise(undefined, mockFn, 'expected', 'args')
      expect(result.pass).toBe(false)
      expect(result.message()).toContain('Expected mock to be called with ["expected","args"]')
      expect(result.message()).toContain('but it was not called')
    })
  })

  describe('New Simulate.change syntax', () => {
    test('demonstrates the improved syntax: expect(Simulate.change(input, value)).toRaise(onChange)', async () => {
      // This demonstrates the new, cleaner syntax
      const onChange = mock()

      // Create a mock element and simulate a change (no third parameter needed!)
      const element = document.createElement('input') as HTMLInputElement

      // Simulate the change event and manually call the handler
      const simulatePromise = Simulate.change(element, 'new value').then(() => {
        onChange('new value', { target: element }, {})
      })

      // Wait for the promise to resolve
      await simulatePromise

      // Check that the mock was called
      expect(simulatePromise).toRaise(onChange)

      // Check that the mock was called with specific arguments (currying)
      expect(simulatePromise).toRaise(onChange, 'new value')
    })
  })
})
