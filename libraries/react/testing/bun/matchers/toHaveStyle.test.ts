import { beforeEach } from 'bun:test'
import { describe, expect, test } from 'bun:test'
import { toHaveStyle } from './toHaveStyle'
describe('toHaveStyle', () => {
  let element: HTMLElement

  beforeEach(() => {
    element = document.createElement('div')
  })

  test('should pass when the element has the specified style as a string', () => {
    element.style.color = 'red'
    const result = toHaveStyle(element, 'color: red')
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected element to have styles: ["color: red"]')
  })

  test('should pass when the element matches the specified style as a RegExp', () => {
    element.style.backgroundColor = '#ff0000'
    const result = toHaveStyle(element, /background-color: #[a-f0-9]{6}/)
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected element to have styles: [{}]')
  })

  test('should pass when the element has the specified style as an object', () => {
    element.style.fontSize = '16px'
    const result = toHaveStyle(element, { fontSize: '16px' })
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected element to have styles: [{"fontSize":"16px"}]')
  })

  test('should fail when the element does not have the specified style as a string', () => {
    element.style.color = 'blue'
    const result = toHaveStyle(element, 'color: red')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected element to have styles: ["color: red"]')
  })

  test('should fail when the element does not match the specified style as a RegExp', () => {
    element.style.backgroundColor = 'rgb(255, 0, 0)'
    const result = toHaveStyle(element, /background-color: #[a-f0-9]{6}/)
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected element to have styles: [{}]')
  })

  test('should fail when the element does not have the specified style as an object', () => {
    element.style.fontSize = '14px'
    const result = toHaveStyle(element, { fontSize: '16px' })
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected element to have styles: [{"fontSize":"16px"}]')
  })

  test('should pass when the element has all specified styles', () => {
    element.style.color = 'red'
    element.style.fontSize = '16px'
    const result = toHaveStyle(element, 'color: red', { fontSize: '16px' })
    expect(result.pass).toBe(true)
    expect(result.message()).toBe('expected element to have styles: ["color: red",{"fontSize":"16px"}]')
  })

  test('should fail when the element is missing one of the specified styles', () => {
    element.style.color = 'red'
    const result = toHaveStyle(element, 'color: red', { fontSize: '16px' })
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('expected element to have styles: ["color: red",{"fontSize":"16px"}]')
  })
})
