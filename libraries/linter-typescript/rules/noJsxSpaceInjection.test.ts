import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noJsxSpaceInjection } from './noJsxSpaceInjection'

describe('noJsxSpaceInjection', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verifyAndFix(
      code,
      [
        {
          languageOptions: {
            parserOptions: {
              ecmaFeatures: { jsx: true },
              ecmaVersion: 'latest',
            },
          },
          plugins: {
            test: {
              rules: {
                'no-jsx-space-injection': noJsxSpaceInjection,
              },
            },
          },
          rules: {
            'test/no-jsx-space-injection': 'error',
          },
        },
      ],
      { filename: 'fixture.js' },
    )
  }

  test('replaces an injection with a literal space', () => {
    const output = lint("<p><strong>a</strong>{' '}b</p>")

    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<p><strong>a</strong> b</p>')
  })

  test('leaves a multiline element injection alone', () => {
    const code = "<p>\n  <strong>a</strong>{' '}b\n</p>"
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('ignores non-space expressions', () => {
    const code = '<p>{value}</p>'
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('leaves whitespace-sensitive elements alone', () => {
    const code = "<pre>{' '}x</pre>"
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
