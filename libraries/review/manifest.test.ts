import { describe, expect, test } from 'bun:test'
import { DEAD_CODE_REVIEWER_ID, PLACEHOLDER_DOCUMENTATION_REVIEWER_ID, REVIEW_POLICY_SCHEMA_VERSION, STANDARD_REVIEW_POLICY_ID, TOOLING_CONFORMANCE_CHURN_REVIEWER_ID, WARNING_BASELINE_REGRESSION_REVIEWER_ID } from './ids'
import { STANDARD_REVIEW_MANIFEST } from './manifest'

describe('standard review manifest', () => {
  test('is the versioned Basis standard', () => {
    expect(STANDARD_REVIEW_MANIFEST.id).toBe(STANDARD_REVIEW_POLICY_ID)
    expect(STANDARD_REVIEW_MANIFEST.schemaVersion).toBe(REVIEW_POLICY_SCHEMA_VERSION)
  })

  test('ships unique reviewer ids', () => {
    const ids = STANDARD_REVIEW_MANIFEST.reviewers.map(reviewer => reviewer.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(
      expect.arrayContaining([
        PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
        WARNING_BASELINE_REGRESSION_REVIEWER_ID,
        TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
        DEAD_CODE_REVIEWER_ID,
      ]),
    )
  })

  test('dead-code consumes only dead-code knip categories', () => {
    const reviewer = STANDARD_REVIEW_MANIFEST.reviewers.find(candidate => candidate.id === DEAD_CODE_REVIEWER_ID)
    if (reviewer === undefined) throw new Error('missing dead-code reviewer')

    const categories = reviewer.detectors.flatMap(detector => detector.categories.map(category => category.category))
    expect(categories).toContain('exports')
    expect(categories).toContain('files')
    expect(categories).not.toContain('unresolved')
    expect(categories).not.toContain('unlisted')
    expect(categories).not.toContain('cycles')
    expect(categories).not.toContain('duplicates')
  })

  test('every reviewer declares outcomes and a valid threshold', () => {
    for (const reviewer of STANDARD_REVIEW_MANIFEST.reviewers) {
      expect(reviewer.outcomes.length).toBeGreaterThan(0)
      expect(reviewer.threshold.minimumConfidence).toBeGreaterThanOrEqual(0)
      expect(reviewer.threshold.minimumConfidence).toBeLessThanOrEqual(1)
    }
  })
})
