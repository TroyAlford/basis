import { describe, expect, test } from 'bun:test'
import { toMatchIndented } from './toMatchIndented'

describe('testing/toMatchIndented', () => {
  test('matches blocks with different baseline indentation', () => {
    expect('SELECT id\n  FROM widgets').toMatchIndented(`
      SELECT id
        FROM widgets
    `)
  })

  test('normalizes CRLF, blank edges, and trailing spaces', () => {
    expect('\r\nSELECT id  \r\nFROM widgets\r\n\r\n').toMatchIndented(`
      SELECT id
      FROM widgets
    `)
  })

  test('preserves relative indentation and internal spacing', () => {
    expect('SELECT  id\n  FROM widgets').toMatchIndented(`
      SELECT  id
        FROM widgets
    `)
    expect('SELECT id\n  FROM widgets').not.toMatchIndented(`
      SELECT id
    FROM widgets
    `)
  })

  test('reports a readable line mismatch', () => {
    const result = toMatchIndented('SELECT id\nFROM widgets', 'SELECT id\nFROM other')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('Expected text:\nSELECT id\nFROM other\nReceived text:\nSELECT id\nFROM widgets')
  })

  test('rejects text that is less indented than its baseline', () => {
    const result = toMatchIndented('  SELECT id\nFROM other', 'SELECT id')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('Text line is less indented than the baseline:\nFROM other')
  })

  test('rejects non-string values', () => {
    const result = toMatchIndented(1, 'SELECT id')
    expect(result.pass).toBe(false)
    expect(result.message()).toBe('toMatchIndented expects strings')
  })
})
