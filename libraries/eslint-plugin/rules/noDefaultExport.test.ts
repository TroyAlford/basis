import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noDefaultExport } from './noDefaultExport'

describe('noDefaultExport', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
          plugins: {
            test: {
              rules: {
                'no-default-export': noDefaultExport,
              },
            },
          },
          rules: {
            'test/no-default-export': 'error',
          },
        },
      ],
      { filename: 'fixture.js' },
    )
  }

  test('reports a default export declaration', () => {
    const output = lint('export default function foo() {}')
    expect(output.fixed).toBe(false)
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0]?.message).toBe('Prefer named exports.')
  })

  test('reports a default value export', () => {
    const output = lint('export default 1')
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0]?.message).toBe('Prefer named exports.')
  })

  test('reports an alias to the default export', () => {
    const output = lint('const foo = 1\nexport { foo as default }')
    expect(output.messages).toHaveLength(1)
    expect(output.messages[0]?.message).toBe(
      'Do not alias `foo` as `default`. Just export `foo` itself instead.',
    )
  })

  test('leaves named exports untouched', () => {
    const code = [
      'export const foo = 1',
      'export function bar() {}',
      'export { foo as baz }',
    ].join('\n')
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.messages).toHaveLength(0)
    expect(output.output).toBe(code)
  })
})
