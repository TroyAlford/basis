import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { noJsxLineBreaks } from './noJsxLineBreaks'

describe('noJsxLineBreaks', () => {
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
                'no-jsx-line-breaks': noJsxLineBreaks,
              },
            },
          },
          rules: {
            'test/no-jsx-line-breaks': 'error',
          },
        },
      ],
      { filename: 'fixture.js' },
    )
  }

  test('joins a wrapped paragraph onto one line', () => {
    const output = lint('<p>\n  Hello\n  world\n</p>')

    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<p>Hello world</p>')
  })

  test('joins around an inlined element', () => {
    const output = lint('<p>\n  text with <span>sub-items</span> in it\n</p>')

    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<p>text with <span>sub-items</span> in it</p>')
  })

  test('joins around an inlined component', () => {
    const output = lint('<p>\n  text with <Badge>text</Badge> in it\n</p>')

    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<p>text with <Badge>text</Badge> in it</p>')
  })

  test('preserves an embedded expression', () => {
    const output = lint('<p>\n  text with {value} in it\n</p>')

    expect(output.fixed).toBe(true)
    expect(output.output).toBe('<p>text with {value} in it</p>')
  })

  test('leaves block children structured', () => {
    const code = '<div>\n  <p>a</p>\n  <p>b</p>\n</div>'
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('leaves a multiline opening tag structured', () => {
    const code = '<Button\n  kind="primary"\n>Menu</Button>'
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('leaves whitespace-sensitive elements structured', () => {
    const code = '<pre>\n  a\n  b\n</pre>'
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('leaves already-single-line elements untouched', () => {
    const code = '<p>Hello world</p>'
    const output = lint(code)

    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })
})
