import * as parser from '@typescript-eslint/parser'
import { Linter } from '@typescript-eslint/utils/ts-eslint'
import { describe, expect, test } from 'bun:test'
import { noMixedTypeImports } from './no-mixed-type-imports.ts'

describe('no-mixed-type-imports', () => {
  const lint = (code: string) => {
    const linter = new Linter({ configType: 'eslintrc' })
    linter.defineRule('no-mixed-type-imports', noMixedTypeImports)
    linter.defineParser('@typescript-eslint/parser', parser)

    return linter.verifyAndFix(code, {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 'latest',
        project: './tsconfig.json',
        sourceType: 'module',
      },
      rules: { 'no-mixed-type-imports': 'error' },
    }, { filename: __filename, fix: true })
  }

  test('outputs with/out semicolons, based on input line', () => {
    const semi = lint("import { a, type b, c } from 'module';")
    console.log('Semi result:', JSON.stringify(semi, null, 2))
    expect(semi.fixed).toBe(true)
    expect(semi.output.trim().split(/\r?\n/)).toEqual([
      "import type { b } from 'module';",
      "import { a, c } from 'module';",
    ])

    const noSemi = lint("import { a, type b, c } from 'module'")
    console.log('NoSemi result:', JSON.stringify(noSemi, null, 2))
    expect(noSemi.fixed).toBe(true)
    expect(noSemi.output.trim().split(/\r?\n/)).toEqual([
      "import type { b } from 'module'",
      "import { a, c } from 'module'",
    ])
  })

  test('leaves correct code alone', () => {
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
})
