import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noObjectPadding } from './no-object-padding'

describe('no-object-padding', () => {
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
                'no-object-padding': noObjectPadding,
              },
            },
          },
          rules: {
            'test/no-object-padding': 'error',
          },
        },
      ],
      // Use a .js path so the default JS parser runs; .ts would require the TS parser.
      { filename: 'fixture.js' },
    )
  }

  test('removes leading padding', () => {
    const output = lint(`
      const obj = {


        a: 1,
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      const obj = {
        a: 1,
      }
    `)
  })

  test('removes trailing padding', () => {
    const output = lint(`
      const obj = {
        a: 1,


      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      const obj = {
        a: 1,
      }
    `)
  })

  test('removes both', () => {
    const output = lint(`
      const obj = {


        a: 1,


      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      const obj = {
        a: 1,
      }
    `)
  })

  test('ignores single-line objects', () => {
    const output = lint('const obj = { a: 1 }')
    expect(output.fixed).toBe(false)
    expect(output.output).toBe('const obj = { a: 1 }')
  })

  test('ignores empty objects', () => {
    const output = lint('const obj = {}')
    expect(output.fixed).toBe(false)
    expect(output.output).toBe('const obj = {}')
  })

  test('ignores objects with comments', () => {
    const output = lint(`
      const obj = {
        // comment
        a: 1,
      }
    `)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(`
      const obj = {
        // comment
        a: 1,
      }
    `)
  })

  test('handles nested objects', () => {
    const output = lint(`
      const obj = {

        a: {

          b: 1

        }

      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      const obj = {
        a: {
          b: 1
        }
      }
    `)
  })
})
