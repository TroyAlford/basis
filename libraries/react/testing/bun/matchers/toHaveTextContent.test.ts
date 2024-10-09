import { describe, expect, test } from 'bun:test'
import { toHaveTextContent } from './toHaveTextContent'

describe('toHaveTextContent', () => {
  test('should pass when the element has the specified text content', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, world!'
    const result = toHaveTextContent(element, 'Hello, world!')
    expect(result.pass).toBe(true)
  })
  test('should pass when the element contains the specified text content', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, world!'
    const result = toHaveTextContent(element, 'world')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected Hello, world! to include world')
  })

  test('should fail when the element does not contain the specified text content', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, world!'
    const result = toHaveTextContent(element, 'foo')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected Hello, world! to include foo')
  })

  test('should pass when the element matches the specified regex', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, world!'
    const result = toHaveTextContent(element, /Hello, \w+!/)
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected Hello, world! to include /Hello, \\w+!/')
  })

  test('should fail when the element does not match the specified regex', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, world!'
    const result = toHaveTextContent(element, /Goodbye, \w+!/)
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected Hello, world! to include /Goodbye, \\w+!/')
  })

  test('should handle empty text content', () => {
    const element = document.createElement('div')
    const result = toHaveTextContent(element, 'any text')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected  to include any text')
  })

  test('should be case sensitive', () => {
    const element = document.createElement('div')
    element.textContent = 'Hello, World!'
    const result = toHaveTextContent(element, 'hello')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected Hello, World! to include hello')
  })
})
