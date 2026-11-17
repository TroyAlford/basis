import { describe, expect, test } from 'bun:test'
import { scanProductionCorpus } from './sqlCorpus'

describe('production SQL corpus', () => {
  test('has no unsupported or unverified production SQL', async () => {
    const report = await scanProductionCorpus()
    expect(report.candidates).toBeGreaterThan(0)
    expect(report.unsupported).toEqual([])
    expect(report.parseFailures).toEqual([])
    expect(report.invalidFormatted).toEqual([])
    expect(report.semanticFailures).toEqual([])
    expect(report.plSemanticFailures).toEqual([])
    expect(report.idempotenceFailures).toEqual([])
  })
})
