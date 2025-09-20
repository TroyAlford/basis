import { describe, expect, test } from 'bun:test'
import { titleCase } from './titleCase'

describe('titleCase', () => {
  test('should convert strings to title case', () => {
    expect(titleCase('hello world')).toBe('Hello World')
    expect(titleCase('hello-world')).toBe('Hello World')
    expect(titleCase('hello_world')).toBe('Hello World')
    expect(titleCase('helloWorld')).toBe('Hello World')
    expect(titleCase('hello world test')).toBe('Hello World Test')
    expect(titleCase('kebab-case-string')).toBe('Kebab Case String')
    expect(titleCase('snake_case_string')).toBe('Snake Case String')
    expect(titleCase('camelCaseString')).toBe('Camel Case String')
  })

  test('should handle edge cases', () => {
    expect(titleCase('')).toBe('')
    expect(titleCase('a')).toBe('A')
    expect(titleCase('A')).toBe('A')
    expect(titleCase('123')).toBe('123')
    expect(titleCase('hello-123-world')).toBe('Hello 123 World')
  })
})
