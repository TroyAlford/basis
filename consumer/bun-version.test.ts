import { describe, expect, test } from 'bun:test'
import { APPROVED_BUN_SERVER_PACKAGE, APPROVED_BUN_SERVER_REVISION, assertBasisServerCompatible, basisServerUnsupportedReason, bunCheckUnsupportedReason, parseBunVersion, supportsBasisServer, supportsBunCheck } from './bun-version'

describe('Bun type-check support', () => {
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
})

describe('Basis Server Bun support', () => {
  test('accepts the approved canary and future stable releases', () => {
    expect(supportsBasisServer({
      revision: APPROVED_BUN_SERVER_REVISION,
      version: '1.4.6',
    })).toBe(true)
    expect(supportsBasisServer({ revision: '1.4.6+stable', version: '1.4.6' })).toBe(true)
    expect(supportsBasisServer({ revision: '1.5.0+stable', version: '1.5.0' })).toBe(true)
    expect(supportsBasisServer({ revision: '2.0.0+stable', version: '2.0.0' })).toBe(true)
  })

  test('rejects known-incompatible stable releases', () => {
    expect(supportsBasisServer({ revision: '1.4.4+stable', version: '1.4.4' })).toBe(false)
    expect(supportsBasisServer({ revision: '1.4.5+stable', version: '1.4.5' })).toBe(false)
  })

  test('rejects unverified prereleases even when numerically newer', () => {
    expect(supportsBasisServer({ revision: '1.4.6-canary.2+abc', version: '1.4.6-canary.2' })).toBe(false)
    expect(supportsBasisServer({ revision: '1.4.6-canary.2+abc', version: '1.4.6' })).toBe(false)
    expect(supportsBasisServer({ revision: '1.4.7-canary.1+abc', version: '1.4.7-canary.1' })).toBe(false)
  })

  test('rejects malformed runtime metadata', () => {
    expect(supportsBasisServer({ revision: 'unknown', version: 'unknown' })).toBe(false)
    expect(supportsBasisServer({ version: '' })).toBe(false)
  })

  test('explains the required runtime and installation method', () => {
    const reason = basisServerUnsupportedReason({ revision: '1.4.5+stable', version: '1.4.5' })
    expect(reason).toContain('Basis Server requires Bun >= 1.4.6')
    expect(reason).toContain(APPROVED_BUN_SERVER_PACKAGE)
    expect(reason).toContain('mise npm')
    expect(() => assertBasisServerCompatible({ revision: '1.4.4+stable', version: '1.4.4' })).toThrow(
      'Basis Server requires Bun',
    )
    expect(assertBasisServerCompatible({
      revision: APPROVED_BUN_SERVER_REVISION,
      version: '1.4.6',
    })).toBeUndefined()
  })
})
