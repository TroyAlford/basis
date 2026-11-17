import { describe, expect, test } from 'bun:test'
import { PL_CORPUS_NODE_TYPES, PL_IMPLEMENTED_NODE_TYPES, SQL_CORPUS_FIELDS, SQL_CORPUS_NODE_TYPES, SQL_IMPLEMENTED_NODE_TYPES, SQL_NODE_STATUS, SQL_SCHEMA_NODE_TYPES, sqlCoverage } from './sqlCoverage'

describe('SQL AST coverage ledger', () => {
  test('classifies every schema node explicitly', () => {
    expect(SQL_SCHEMA_NODE_TYPES.length).toBeGreaterThan(0)
    for (const node of SQL_SCHEMA_NODE_TYPES) {
      expect(SQL_NODE_STATUS.has(node)).toBe(true)
    }
  })

  test('covers every node exercised by the production corpus', () => {
    const missingSql = SQL_CORPUS_NODE_TYPES.filter(node => !SQL_IMPLEMENTED_NODE_TYPES.has(node))
    const missingPl = PL_CORPUS_NODE_TYPES.filter(node => !PL_IMPLEMENTED_NODE_TYPES.has(node))
    expect(missingSql).toEqual([])
    expect(missingPl).toEqual([])
    expect(sqlCoverage().corpusPercent).toBe(100)
  })

  test('records fields and variants for corpus nodes', () => {
    for (const node of [...SQL_CORPUS_NODE_TYPES, ...PL_CORPUS_NODE_TYPES]) {
      expect(SQL_CORPUS_FIELDS.has(node)).toBe(true)
    }
  })
})
