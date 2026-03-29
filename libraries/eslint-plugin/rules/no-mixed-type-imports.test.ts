import * as parser from '@typescript-eslint/parser'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noMixedTypeImports } from './no-mixed-type-imports'

describe('no-mixed-type-imports', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          files: ['**/*.ts', '**/*.tsx'],
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
                'no-mixed-type-imports': noMixedTypeImports,
              },
            },
          },
          rules: {
            'test/no-mixed-type-imports': 'error',
          },
        },
      ],
      { filename: 'no-mixed-type-imports.fixture.ts', fix: true },
    )
  }

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
