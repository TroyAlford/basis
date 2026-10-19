import { describe, expect, test } from 'bun:test'
import { bunCheckUnsupportedReason, bunLintUnsupportedReason, parseBunVersion, supportsBunCheck, supportsBunLint } from './bun-version'

describe('Bun native tooling support', () => {
  test('parses numeric versions and ignores pre-release metadata', () => {
    expect(parseBunVersion('1.4.3')).toEqual([1, 4, 3])
    expect(parseBunVersion('1.4.4-canary.1+abc')).toEqual([1, 4, 4])
    expect(parseBunVersion('not-a-version')).toBeNull()
  })

  test('accepts the first supporting release and newer', () => {
    expect(supportsBunCheck('1.4.3')).toBe(true)
    expect(supportsBunCheck('1.4.4')).toBe(true)
    expect(supportsBunCheck('1.5.0')).toBe(true)
    expect(supportsBunCheck('2.0.0')).toBe(true)
  })

  test('rejects older and malformed versions', () => {
    expect(supportsBunCheck('1.3.99')).toBe(false)
    expect(supportsBunCheck('1.4.2')).toBe(false)
    expect(supportsBunCheck('unknown')).toBe(false)
  })

  test('explains how to upgrade an unsupported runtime', () => {
    const reason = bunCheckUnsupportedReason('1.4.2')
    expect(reason).toContain('>= 1.4.3')
    expect(reason).toContain('bun upgrade')
    expect(bunCheckUnsupportedReason('1.4.3')).toBeNull()
  })

  test('requires the native linter release for lint support', () => {
    expect(supportsBunLint('1.4.3')).toBe(false)
    expect(supportsBunLint('1.4.4')).toBe(true)
    expect(supportsBunLint('1.4.4-canary.1')).toBe(true)
    expect(supportsBunLint('1.5.0')).toBe(true)
  })

  test('explains how to upgrade an unsupported lint runtime', () => {
    const reason = bunLintUnsupportedReason('1.4.3')
    expect(reason).toContain('>= 1.4.4')
    expect(reason).toContain('bun upgrade')
    expect(bunLintUnsupportedReason('1.4.4')).toBeNull()
  })
})
