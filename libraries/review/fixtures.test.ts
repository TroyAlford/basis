import { describe, expect, test } from 'bun:test'
import { STANDARD_REVIEW_FIXTURES } from './fixtures'
import { DEAD_CODE_REVIEWER_ID, PLACEHOLDER_DOCUMENTATION_REVIEWER_ID, TOOLING_CONFORMANCE_CHURN_REVIEWER_ID, WARNING_BASELINE_REGRESSION_REVIEWER_ID } from './ids'
import { STANDARD_REVIEW_MANIFEST } from './manifest'

describe('standard review fixtures', () => {
  test('have unique ids that reference known reviewers', () => {
    const ids = STANDARD_REVIEW_FIXTURES.map(fixture => fixture.id)
    expect(new Set(ids).size).toBe(ids.length)

    const reviewerIds = new Set(STANDARD_REVIEW_MANIFEST.reviewers.map(reviewer => reviewer.id))
    for (const fixture of STANDARD_REVIEW_FIXTURES) {
      expect(reviewerIds.has(fixture.reviewerId)).toBe(true)
    }
  })

  test('give every initial policy positive and negative examples', () => {
    const initial = [
      PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
      WARNING_BASELINE_REGRESSION_REVIEWER_ID,
      TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
      DEAD_CODE_REVIEWER_ID,
    ]

    for (const reviewerId of initial) {
      const fixtures = STANDARD_REVIEW_FIXTURES.filter(fixture => fixture.reviewerId === reviewerId)
      expect(fixtures.some(fixture => fixture.expectation === 'finding')).toBe(true)
      expect(
        fixtures.some(fixture => fixture.expectation === 'no_finding' || fixture.expectation === 'abstain'),
      ).toBe(true)
    }
  })

  test('demonstrates dead-code abstention', () => {
    const abstains = STANDARD_REVIEW_FIXTURES.filter(
      fixture => fixture.reviewerId === DEAD_CODE_REVIEWER_ID && fixture.expectation === 'abstain',
    )
    expect(abstains.length).toBeGreaterThan(0)
  })
})
