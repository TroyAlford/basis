import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string) => lintRule('noAlternativeTestRenderer', code, 'fixture.test.tsx')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noAlternativeTestRenderer')
  expect(messages[0]?.message).toContain('basis/testing')
}

describe('noAlternativeTestRenderer', () => {
  test('reports Testing Library render', () => {
    expectsReport('import { render } from \'@testing-library/react\'\nrender(<div />)')
  })

  test('reports an aliased Testing Library render', () => {
    expectsReport('import { render as mount } from \'@testing-library/react\'\nmount(<div />)')
  })

  test('reports a Testing Library namespace member', () => {
    expectsReport('import * as testing from \'@testing-library/react\'\ntesting.render(<div />)')
  })

  test('reports Testing Library DOM queries', () => {
    expectsReport('import { within } from \'@testing-library/dom\'\nwithin(document.body)')
  })

  test('reports user-event', () => {
    expectsReport('import userEvent from \'@testing-library/user-event\'\nawait userEvent.click(document.body)')
  })

  test('reports react-test-renderer', () => {
    expectsReport('import TestRenderer from \'react-test-renderer\'\nTestRenderer.create(<div />)')
  })

  test('reports a react-test-renderer require', () => {
    expectsReport('const { create } = require(\'react-test-renderer\')\ncreate(<div />)')
  })

  test('reports enzyme shallow', () => {
    expectsReport('import { shallow } from \'enzyme\'\nshallow(<div />)')
  })

  test('reports an enzyme adapter', () => {
    expectsReport('import Adapter from \'enzyme-adapter-react-19\'\nnew Adapter()')
  })

  test('reports react-dom/client createRoot', () => {
    expectsReport('import { createRoot } from \'react-dom/client\'\ncreateRoot(document.body)')
  })

  test('reports a react-dom/client alias', () => {
    expectsReport('import { createRoot as mount } from \'react-dom/client\'\nmount(document.body)')
  })

  test('reports ReactDOM.render', () => {
    expectsReport('import ReactDOM from \'react-dom\'\nReactDOM.render(<div />, document.body)')
  })

  test('reports ReactDOM.hydrate', () => {
    expectsReport('import * as ReactDOM from \'react-dom\'\nReactDOM.hydrate(<div />, document.body)')
  })

  test('reports react-dom/test-utils act', () => {
    expectsReport('import { act } from \'react-dom/test-utils\'\nawait act(async () => undefined)')
  })

  test('allows type-only renderer imports', () => {
    expect(lint([
      'import type { ReactTestRenderer } from \'react-test-renderer\'',
      'const value: ReactTestRenderer | null = null',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows the Basis testing renderer', () => {
    expect(lint([
      'import { render, Simulate, waitFor } from \'basis/testing\'',
      'render(<div />)',
      'Simulate.click(document.body)',
      'await waitFor(() => undefined)',
    ].join('\n'))).toHaveLength(0)
  })
})
