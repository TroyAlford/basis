import { describe, expect, test } from 'bun:test'
import { transformJsxDev } from '../../source/utilities/transformJsxDev'

// Helper to normalize code for comparison
const normalize = (code: string): string => (
  code.replace(/\s/g, '')
    .replace(/;$/, '')
    .trim()
)

describe('transformJsxDev', () => {
  const testCases = [{
    expected: `
      React.createElement("div", {
        className: "test"
      })
    `,
    input: `
      jsx_dev_runtime1.jsxDEV("div", {
        className: "test"
      }, void 0, false, void 0, this)
    `,
    name: 'transforms basic jsxDEV calls to React.createElement',
  }, {
    expected: 'React.Fragment',
    input: 'jsx_dev_runtime1.Fragment',
    name: 'transforms Fragment references',
  }, {
    expected: `
      React.createElement("div", {
        children: React.createElement("span", {
          children: "Hello"
        })
      })
    `,
    input: `
      jsx_dev_runtime1.jsxDEV("div", {
        children: jsx_dev_runtime1.jsxDEV("span", {
          children: "Hello"
        }, void 0, false, void 0, this)
      }, void 0, false, void 0, this)
    `,
    name: 'handles nested jsxDEV calls',
  }, {
    expected: `
      React.createElement("div", {
        style: { color: "red", margin: "10px" },
        onClick: (e) => { console.log(e); return false; }
      })
    `,
    input: `
      jsx_dev_runtime1.jsxDEV("div", {
        style: { color: "red", margin: "10px" },
        onClick: (e) => { console.log(e); return false; }
      }, void 0, false, void 0, this)
    `,
    name: 'handles complex props with commas',
  }]

  testCases.forEach(({ expected, input, name }) => {
    test(name, () => {
      expect(normalize(transformJsxDev(input)))
        .toBe(normalize(expected))
    })
  })
})
