import { describe, expect, test } from 'bun:test'
import { DEAD_CODE_REVIEWER_ID } from './ids'
import { STANDARD_REVIEW_MANIFEST } from './manifest'
import { assertReviewerOverlay, assertReviewerPolicy, parseReviewerOverlays } from './validate'

describe('assertReviewerPolicy', () => {
  test('accepts a standard reviewer', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    expect(assertReviewerPolicy(base, 'test').id).toBe(DEAD_CODE_REVIEWER_ID)
  })

  test('rejects unknown fields and malformed nested values', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    const withExtra = { ...base, extra: true }
    expect(() => assertReviewerPolicy(withExtra, 'test')).toThrow('unknown field "extra"')

    const badDetector = { ...base, detectors: [{ categories: 'nope', detector: 'knip' }] }
    expect(() => assertReviewerPolicy(badDetector, 'test')).toThrow('"categories" must be an array')

    const badConfidence = { ...base, threshold: { minimumConfidence: 'high', severity: 'warning' } }
    expect(() => assertReviewerPolicy(badConfidence, 'test')).toThrow('"minimumConfidence" must be a finite number')

    const duplicateOutcomes = {
      ...base,
      outcomes: [
        { category: 'dup', description: 'one', destructive: false, outcome: 'finding' },
        { category: 'dup', description: 'two', destructive: false, outcome: 'abstain' },
      ],
    }
    expect(() => assertReviewerPolicy(duplicateOutcomes, 'test')).toThrow('outcome categories must be unique')
  })
})

describe('assertReviewerOverlay', () => {
  test('rejects a non-object and unknown fields', () => {
    expect(() => assertReviewerOverlay('nope')).toThrow('overlay: must be an object')

    const withExtra = { extra: true, id: 'dead-code', mode: 'disable', reason: 'temporarily' }
    expect(() => assertReviewerOverlay(withExtra)).toThrow('unknown field "extra"')
  })

  test('rejects a malformed nested patch on extend', () => {
    const patch = { id: DEAD_CODE_REVIEWER_ID, mode: 'extend', policy: { bogus: 1 } }
    expect(() => assertReviewerOverlay(patch)).toThrow('unknown field "bogus"')

    const badOutcome = {
      id: DEAD_CODE_REVIEWER_ID,
      mode: 'extend',
      policy: {
        outcomes: [{ category: 'x', description: 'd', destructive: 'yes', outcome: 'finding' }],
      },
    }
    expect(() => assertReviewerOverlay(badOutcome)).toThrow('"destructive" must be a boolean')
  })
})

describe('parseReviewerOverlays', () => {
  test('requires an array and validates every entry', () => {
    expect(() => parseReviewerOverlays({})).toThrow('"overlays" must be an array')
    expect(() => parseReviewerOverlays([{ id: 'x', mode: 'bogus' }])).toThrow('"mode" must be one of')
    expect(parseReviewerOverlays([{ id: 'dead-code', mode: 'disable', reason: 'off' }])).toHaveLength(1)
  })
})
