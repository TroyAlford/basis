import { beforeEach } from 'bun:test'
import { describe, expect, test } from 'bun:test'
import { toHaveAttribute } from './toHaveAttribute'

describe('toHaveAttribute', () => {
  let element: HTMLElement

  beforeEach(() => {
    element = document.createElement('div')
  })

  test('should pass when the element has the specified attribute with the exact value', () => {
    element.setAttribute('data-test', 'value')
    const result = toHaveAttribute(element, 'data-test', 'value')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected value to equal value')
  })

  test('should pass when the element has the specified attribute regardless of its value', () => {
    element.setAttribute('data-test', 'any-value')
    const result = toHaveAttribute(element, 'data-test')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected element to have attribute data-test')
  })

  test('should fail when the element does not have the specified attribute', () => {
    const result = toHaveAttribute(element, 'data-test')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected element to have attribute data-test')
  })

  test('should fail when the element has the attribute but with a different value', () => {
    element.setAttribute('data-test', 'different')
    const result = toHaveAttribute(element, 'data-test', 'value')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected different to equal value')
  })

  test('should pass when the element has the attribute with a value matching the regex', () => {
    element.setAttribute('data-test', 'value123')
    const result = toHaveAttribute(element, 'data-test', /value\d+/)
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected value123 to equal /value\\d+/')
  })

  test('should fail when the element has the attribute but the value does not match the regex', () => {
    element.setAttribute('data-test', 'value')
    const result = toHaveAttribute(element, 'data-test', /different/)
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected value to equal /different/')
  })
})
