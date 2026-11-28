import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { lintWithBun } from './testUtils'

const lint = (code: string) => lintWithBun({
  code,
  fix: true,
  ruleExport: 'sortInterface',
  ruleName: 'sort-interface',
  rulePath: join(import.meta.dir, 'sortInterface.ts'),
})

describe('sort-interface', () => {

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
