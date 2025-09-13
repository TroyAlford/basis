import { describe, expect, test } from 'bun:test'
import { pascalCase } from './pascalCase'

describe('pascalCase', () => {
  test('converts strings to PascalCase', () => {
    expect(pascalCase('hello world')).toBe('HelloWorld')
    expect(pascalCase('hello-world')).toBe('HelloWorld')
    expect(pascalCase('hello_world')).toBe('HelloWorld')
    expect(pascalCase('helloWorld')).toBe('HelloWorld')
    expect(pascalCase('hello world test')).toBe('HelloWorldTest')
    expect(pascalCase('kebab-case-string')).toBe('KebabCaseString')
    expect(pascalCase('snake_case_string')).toBe('SnakeCaseString')
  })

  test('handles edge cases', () => {
    expect(pascalCase('')).toBe('')
    expect(pascalCase('a')).toBe('A')
    expect(pascalCase('A')).toBe('A')
    expect(pascalCase('123')).toBe('123')
    expect(pascalCase('hello-123-world')).toBe('Hello123World')
  })
})
