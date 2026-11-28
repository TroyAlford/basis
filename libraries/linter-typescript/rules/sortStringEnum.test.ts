import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { lintWithBun } from './testUtils'

const lint = (code: string) => lintWithBun({
  code,
  fix: true,
  ruleExport: 'sortStringEnum',
  ruleName: 'sort-string-enum',
  rulePath: join(import.meta.dir, 'sortStringEnum.ts'),
})

describe('sort-string-enum', () => {

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
