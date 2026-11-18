/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { formatSQL, formatSQLResult, sqlTemplateFormat } from './sqlTemplateFormat'

describe('sqlTemplateFormat exports', () => {
  test('exposes the formatter boundary', () => {
    expect(formatSQL('select 1')).toBe('SELECT 1')
    expect(formatSQLResult('select 1')).toEqual({ sql: 'SELECT 1', status: 'formatted' })
  })

  test('is a layout rule with a fixable canonical-format message', () => {
    expect(sqlTemplateFormat.meta?.fixable).toBe('code')
    expect(sqlTemplateFormat.meta?.messages?.formatSql).toBe('SQL template is not in canonical format.')
    expect(sqlTemplateFormat.meta?.messages?.unsupportedSql).toContain('Unsupported SQL syntax')
  })
})
