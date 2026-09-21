import { describe, expect, test } from 'bun:test'
import { STANDARD_REVIEW_FIXTURES } from './fixtures'
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

  test('cover every disposition', () => {
    const expectations = new Set(STANDARD_REVIEW_FIXTURES.map(fixture => fixture.expectation))
    expect(expectations).toEqual(new Set(['abstain', 'finding', 'no_finding', 'question']))
  })
})
