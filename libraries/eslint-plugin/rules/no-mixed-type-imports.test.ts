import * as parser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { describe, expect, test } from 'bun:test'
import { noMixedTypeImports } from './no-mixed-type-imports'

describe('no-mixed-type-imports', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          languageOptions: {
            parser,
            parserOptions: {
              ecmaVersion: 'latest',
              project: './tsconfig.json',
              sourceType: 'module',
            },
          },
          plugins: {
            test: {
              rules: {
                'no-mixed-type-imports': noMixedTypeImports,
              },
            },
          },
          rules: {
            'test/no-mixed-type-imports': 'error',
          },
        },
      ],
      { filename: __filename, fix: true },
    )
  }

  test.skipIf(!!Bun.env.CI)('outputs with/out semicolons, based on input line', () => {
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
