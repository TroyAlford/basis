import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { lintWithBun } from './testUtils'

const lint = (code: string) => lintWithBun({
  code,
  filename: 'fixture.tsx',
  fix: true,
  ruleExport: 'sortJsxProps',
  ruleName: 'sort-jsx-props',
  rulePath: join(import.meta.dir, 'sortJsxProps.ts'),
})

describe('sort-jsx-props', () => {
  test('sorts props into the configured groups', () => {
    const output = lint('<Foo onClick={handle} className="x" ref={ref} disabled />')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<Foo ref={ref} disabled className="x" onClick={handle} />')
  })

  test('keeps spread attributes in place', () => {
    const code = '<Foo className="x" {...props} onFocus={focus} />'
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
