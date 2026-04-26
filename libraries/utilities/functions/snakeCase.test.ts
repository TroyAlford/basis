import { describe, expect, test } from 'bun:test'
import { snakeCase } from './snakeCase'

describe('snakeCase', () => {
  test.each([
    ['', ''],
    ['hello world', 'hello_world'],
    ['hello-world', 'hello_world'],
    ['hello_world', 'hello_world'],
    ['helloWorld', 'hello_world'],
    ['HelloWorld', 'hello_world'],
    ['  hello   world  ', 'hello_world'],
    ['café', 'cafe'],
    ['foo__bar', 'foo_bar'],
  ])('snakeCase(%p) -> %p', (input, expected) => {
    expect(snakeCase(input)).toEqual(expected)
  })
})
