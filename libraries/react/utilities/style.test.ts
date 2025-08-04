import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { css, style } from './style'

describe('style utility', () => {
  beforeEach(() => {
    // Clean up any existing style tags from previous tests
    const styleElements = document.querySelectorAll('style[data-injected-by="style-utility"]')
    styleElements.forEach(el => el.remove())
  })

  afterEach(() => {
    // Clean up any style tags created during the test
    const styleElements = document.querySelectorAll('style[data-injected-by="style-utility"]')
    styleElements.forEach(el => el.remove())
  })

  describe('style function', () => {
    test('creates a new style tag when one does not exist', () => {
      const id = 'test-styles'
      const cssString = '.test { color: red; }'

      style(id, cssString)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement).toBeDefined()
      expect(styleElement.tagName).toBe('STYLE')
      expect(styleElement.textContent).toBe(cssString)
      expect(styleElement.getAttribute('data-injected-by')).toBe('style-utility')
    })

    test('updates existing style tag when one already exists', () => {
      const id = 'existing-styles'
      const initialCSS = '.initial { color: blue; }'
      const updatedCSS = '.updated { color: red; }'

      // Create initial style
      style(id, initialCSS)

      // Update the style
      style(id, updatedCSS)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement.textContent).toBe(updatedCSS)

      // Should only be one style tag with this ID
      const allStyles = document.querySelectorAll(`#${id}`)
      expect(allStyles.length).toBe(1)
    })

    test('handles multiple style tags with different IDs', () => {
      const id1 = 'component-a'
      const id2 = 'component-b'
      const css1 = '.component-a { background: blue; }'
      const css2 = '.component-b { background: red; }'

      style(id1, css1)
      style(id2, css2)

      const style1 = document.getElementById(id1) as HTMLStyleElement
      const style2 = document.getElementById(id2) as HTMLStyleElement

      expect(style1.textContent).toBe(css1)
      expect(style2.textContent).toBe(css2)
      expect(style1).not.toBe(style2)
    })

    test('handles empty CSS string', () => {
      const id = 'empty-styles'
      const cssString = ''

      style(id, cssString)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement.textContent).toBe('')
    })

    test('handles CSS with special characters', () => {
      const id = 'special-chars'
      const cssString = `
        .test::before {
          content: "Hello 'World'";
          color: #ff0000;
        }
      `

      style(id, cssString)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement.textContent).toBe(cssString)
    })

    test('creates style tag in document head', () => {
      const id = 'head-test'
      const cssString = '.test { margin: 0; }'

      style(id, cssString)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement.parentElement).toBe(document.head)
    })
  })

  describe('css template literal', () => {
    test('returns raw string without interpolation', () => {
      const result = css`
        .test {
          color: red;
          font-size: 16px;
        }
      `

      expect(result).toBe(`
        .test {
          color: red;
          font-size: 16px;
        }
      `)
    })

    test('handles template with variables (ignores them)', () => {
      const color = 'red'
      const size = '16px'

      const result = css`
        .test {
          color: ${color};
          font-size: ${size};
        }
      `

      // Should return the raw template, not interpolated
      expect(result).toBe(`
        .test {
          color: ${color};
          font-size: ${size};
        }
      `)
    })

    test('preserves whitespace and formatting', () => {
      const result = css`
        .container {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
      `

      expect(result).toContain('display: flex')
      expect(result).toContain('align-items: center')
      expect(result).toContain('justify-content: space-between')
    })

    test('works with the style function', () => {
      const id = 'css-template-test'
      const cssContent = css`
        .button {
          padding: 8px 16px;
          border-radius: 4px;
          background: #007bff;
          color: white;
        }
      `

      style(id, cssContent)

      const styleElement = document.getElementById(id) as HTMLStyleElement
      expect(styleElement.textContent).toBe(cssContent)
    })

    test('handles complex CSS with nested selectors', () => {
      const result = css`
        .parent {
          display: flex;

          .child {
            flex: 1;

            &:hover {
              background: #f0f0f0;
            }
          }
        }
      `

      expect(result).toContain('.parent')
      expect(result).toContain('.child')
      expect(result).toContain('&:hover')
    })
  })

  describe('integration tests', () => {
    test('style and css work together for component styling', () => {
      const componentStyles = css`
        .my-component {
          border: 1px solid #ccc;
          padding: 16px;
        }

        .my-component .title {
          font-size: 18px;
          font-weight: bold;
        }
      `

      style('my-component-styles', componentStyles)

      const styleElement = document.getElementById('my-component-styles') as HTMLStyleElement
      expect(styleElement.textContent).toBe(componentStyles)
      expect(styleElement.textContent).toContain('.my-component')
      expect(styleElement.textContent).toContain('.title')
    })

    test('multiple style calls with css template literals', () => {
      const buttonStyles = css`
        .btn {
          padding: 8px 16px;
          border-radius: 4px;
        }
      `

      const inputStyles = css`
        .input {
          border: 1px solid #ccc;
          padding: 8px;
        }
      `

      style('button-styles', buttonStyles)
      style('input-styles', inputStyles)

      const buttonStyle = document.getElementById('button-styles') as HTMLStyleElement
      const inputStyle = document.getElementById('input-styles') as HTMLStyleElement

      expect(buttonStyle.textContent).toBe(buttonStyles)
      expect(inputStyle.textContent).toBe(inputStyles)
    })
  })
})
