import { describe, expect, test } from 'bun:test'
import { Application } from './Application.tsx'
import { Layout } from './components/Layout.tsx'

describe('docs Application entrypoint', () => {
  test('exports the component Server.main renders', () => {
    expect(Application).toBe(Layout)
  })
})
