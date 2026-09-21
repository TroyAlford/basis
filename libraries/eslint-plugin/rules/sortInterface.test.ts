import * as parser from '@typescript-eslint/parser'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sortInterface } from './sortInterface'

describe('sort-interface', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser,
            parserOptions: {
              ecmaVersion: 'latest',
              sourceType: 'module',
            },
          },
          plugins: {
            test: {
              rules: {
                'sort-interface': sortInterface,
              },
            },
          },
          rules: {
            'test/sort-interface': 'error',
          },
        },
      ],
      { filename: 'sort-interface.fixture.ts' },
    )
  }

  test('sorts interface members ascending', () => {
    const output = lint(`
      interface Foo {
        b: string,
        a: string,
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      interface Foo {
        a: string,
        b: string
      }
    `)
  })

  test('sorts type-literal aliases', () => {
    const output = lint(`
      type Foo = {
        b: string,
        a: string,
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      type Foo = {
        a: string,
        b: string
      }
    `)
  })

  test('applies the original index-signature weighting', () => {
    /*
     * The upstream rule weights index signatures (getWeight = 100) and, with
     * its `compare(a, b) - weight(a) + weight(b)` formula, that places them
     * ahead of regular members. Verified against the installed original.
     */
    const output = lint(`
      interface Foo {
        a: string,
        [index: string]: string,
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      interface Foo {
        [index: string]: string,
        a: string
      }
    `)
  })

  test('carries leading comments along with the member', () => {
    const output = lint(`
      interface Foo {
        // b comment
        b: string,
        a: string,
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      interface Foo {
        a: string,
        // b comment
        b: string
      }
    `)
  })

  test('leaves already-sorted interfaces untouched', () => {
    const code = `
      interface Foo {
        a: string,
        b: string,
      }
    `
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
