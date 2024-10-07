import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noObjectPadding } from './no-object-padding'

describe('no-object-padding', () => {
  const lint = (code: string) => {
    const linter = new Linter({ configType: 'eslintrc' })
    // @ts-expect-error - this seems impossible to type correctly
    linter.defineRule('no-object-padding', noObjectPadding)

    return linter.verifyAndFix(code, {
      parserOptions: { ecmaVersion: 'latest' },
      rules: { 'no-object-padding': 'error' },
    }, { filename: __filename })
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
