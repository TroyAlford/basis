import { beforeEach } from 'bun:test'
import { describe, expect, test } from 'bun:test'
import { toHaveClass } from './toHaveClass'

describe('toHaveClass', () => {
  let element: HTMLElement

  beforeEach(() => {
    element = document.createElement('div')
  })

  test('should pass when the element has the specified class', () => {
    element.className = 'test-class'
    const result = toHaveClass(element, 'test-class')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected test-class to include test-class')
  })

  test('should fail when the element does not have the specified class', () => {
    element.className = 'another-class'
    const result = toHaveClass(element, 'test-class')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected another-class to include test-class')
  })

  test('should pass when the element has all specified classes', () => {
    element.className = 'class-one class-two'
    const result = toHaveClass(element, 'class-one', 'class-two')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected class-one class-two to include class-one class-two')
  })

  test('should fail when the element is missing one of the specified classes', () => {
    element.className = 'class-one'
    const result = toHaveClass(element, 'class-one', 'class-two')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected class-one to include class-one class-two')
  })

  test('should pass when the element has the classes, regardless of order', () => {
    element.className = 'class-two class-one'
    const result = toHaveClass(element, 'class-one', 'class-two')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected class-two class-one to include class-one class-two')
  })
})
