import { captureRuntimeSql } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { scanProductionCorpus } from './sqlCorpus'

describe('production SQL corpus', () => {
  test('has no unsupported or unverified production SQL', async () => {
    const runtime = await captureRuntimeSql()
    const report = await scanProductionCorpus(
      runtime.sql.map((sql, index) => ({ file: 'runtime-producer', source: 'runtime', sql: `${sql} -- ${index}` })),
      runtime.sites,
    )
    expect(report.candidates).toBeGreaterThan(0)
    expect(report.unsupported).toEqual([])
    expect(report.parseFailures).toEqual([])
    expect(report.invalidFormatted).toEqual([])
    expect(report.semanticFailures).toEqual([])
    expect(report.plSemanticFailures).toEqual([])
    expect(report.idempotenceFailures).toEqual([])
  })
})
