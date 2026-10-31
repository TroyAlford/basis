import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { lintWithBun } from './testUtils'

const lint = (code: string) => lintWithBun({
  code,
  fix: true,
  ruleExport: 'noMixedTypeImports',
  ruleName: 'no-mixed-type-imports',
  rulePath: join(import.meta.dir, 'no-mixed-type-imports.ts'),
})

describe('no-mixed-type-imports', () => {

  test('outputs with/out semicolons, based on input line', () => {
    const semi = lint("import { a, type b, c } from 'module';")
    expect(semi.fixed).toBe(true)
    expect(semi.output.split(/\n/)).toEqual([
      "import type { b } from 'module';",
      "import { a, c } from 'module';",
    ])

    const noSemi = lint("import { a, type b, c } from 'module'")
    expect(noSemi.fixed).toBe(true)
    expect(noSemi.output.split(/\n/)).toEqual([
      "import type { b } from 'module'",
      "import { a, c } from 'module'",
    ])
  })

  test('leaves type and non-type imports on separate lines', () => {
    const code = [
      "import { a } from 'module'",
      "import type { b } from 'module'",
    ].join('\n')
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
