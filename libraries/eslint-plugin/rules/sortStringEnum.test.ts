import * as parser from '@typescript-eslint/parser'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sortStringEnum } from './sortStringEnum'

describe('sort-string-enum', () => {
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
                'sort-string-enum': sortStringEnum,
              },
            },
          },
          rules: {
            'test/sort-string-enum': 'error',
          },
        },
      ],
      { filename: 'sort-string-enum.fixture.ts' },
    )
  }

  test('sorts string enum members ascending', () => {
    const output = lint(`
      enum Foo {
        B = 'b',
        A = 'a',
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      enum Foo {
        A = 'a',
        B = 'b'
      }
    `)
  })

  test('carries leading comments along with the member', () => {
    const output = lint(`
      enum Foo {
        // b
        B = 'b',
        // a
        A = 'a',
      }
    `)
    expect(output.fixed).toBe(true)
    expect(output.output).toBe(`
      enum Foo {
        // a
        A = 'a',
        // b
        B = 'b'
      }
    `)
  })

  test('leaves already-sorted string enums untouched', () => {
    const code = `
      enum Foo {
        A = 'a',
        B = 'b',
      }
    `
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
