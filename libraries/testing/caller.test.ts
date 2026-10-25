import { describe, expect, test } from 'bun:test'
import { isTestFile } from './caller'

describe('testing/caller', () => {
  test('recognizes the default fast-lane suffixes', () => {
    expect(isTestFile('/repo/src/Button.test.ts')).toBe(true)
    expect(isTestFile('/repo/src/Button.test.tsx')).toBe(true)
    expect(isTestFile('/repo/src/Button.dom.test.tsx')).toBe(true)
    expect(isTestFile('/repo/src/Button.spec.ts')).toBe(true)
    expect(isTestFile('/repo/src/Button.spec.jsx')).toBe(true)
  })

  test('recognizes the opt-in visual and end-to-end lanes', () => {
    expect(isTestFile('/repo/source/visual/Button.screenshot.tsx')).toBe(true)
    expect(isTestFile('/repo/source/visual/Button.screenshot.ts')).toBe(true)
    expect(isTestFile('/repo/source/e2e/Checkout.e2e.ts')).toBe(true)
    expect(isTestFile('/repo/source/e2e/Checkout.e2e.tsx')).toBe(true)
  })

  test('rejects ordinary source, fixtures, and partial suffixes', () => {
    expect(isTestFile('/repo/src/Button.tsx')).toBe(false)
    expect(isTestFile('/repo/src/Button.screenshot.ts.txt')).toBe(false)
    expect(isTestFile('/repo/src/Button.test')).toBe(false)
    expect(isTestFile('/repo/src/Button.e2e.ts.bak')).toBe(false)
    expect(isTestFile('/repo/src/screenshot.tsx')).toBe(false)
  })
})
