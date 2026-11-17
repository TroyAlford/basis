import { describe, expect, test } from 'bun:test'
import { scanProductionCorpus } from './sqlCorpus'
import { SQL_SCHEMA_NODE_TYPES, sqlCoverage } from './sqlCoverage'

describe('SQL AST coverage ledger', () => {
  test('derives coverage from the executable production corpus', async () => {
    const report = await scanProductionCorpus()
    expect(report.unsupported).toEqual([])
    expect(report.parseFailures).toEqual([])
    expect(report.invalidFormatted).toEqual([])
    expect(report.semanticFailures).toEqual([])
    expect(report.plSemanticFailures).toEqual([])
    expect(report.idempotenceFailures).toEqual([])
    for (const node of report.nodes.keys()) {
      expect(SQL_SCHEMA_NODE_TYPES.includes(node) || node.startsWith('PLpgSQL_')).toBe(true)
    }
    expect(sqlCoverage(report).corpusPercent).toBe(100)
  })
})
