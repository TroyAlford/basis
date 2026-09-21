import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sortKeys } from './sortKeys'

describe('sortKeys', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          languageOptions: {
            parserOptions: { ecmaVersion: 'latest' },
          },
          plugins: {
            test: {
              rules: {
                'sort-keys': sortKeys,
              },
            },
          },
          rules: {
            'test/sort-keys': 'error',
          },
        },
      ],
      // Use a .js path so the default JS parser runs; .ts would require the TS parser.
      { filename: 'fixture.js' },
    )
  }

  test('sorts keys in ascending order', () => {
    const output = lint('const obj = { b: 1, a: 2, c: 3 }')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('const obj = { a: 2, b: 1, c: 3 }')
  })

  test('sorts nested objects independently', () => {
    const output = lint('const obj = { x: { d: 1, c: 2 }, a: 3 }')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('const obj = { a: 3, x: { c: 2, d: 1 } }')

    const inner = lint('const obj = { a: 1, b: { d: 2, c: 3 } }')
    expect(inner.fixed).toBe(true)
    expect(inner.output).toBe('const obj = { a: 1, b: { c: 3, d: 2 } }')
  })

  test('resets ordering at a spread element', () => {
    const output = lint('const obj = { c: 1, ...s, b: 2, a: 3 }')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('const obj = { c: 1, ...s, a: 3, b: 2 }')
  })

  test('moves leading comments with their property', () => {
    const output = lint('const obj = {\n  b: 1,\n  // comment for a\n  a: 2,\n}')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('const obj = {\n  // comment for a\na: 2,\n  \n  b: 1,\n}')
  })

  test('leaves object patterns untouched', () => {
    const code = 'const { b, a } = obj'
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('reports already-sorted input without fixing', () => {
    const code = 'const obj = { a: 1, b: 2, c: 3 }'
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
