import { describe, expect, test } from 'bun:test'
import { STANDARD_REVIEW_MANIFEST } from './manifest'
import type { ReviewerPolicy } from './types'
import { assertReviewerOverlay, assertReviewerPolicy, parseReviewerOverlays } from './validate'

/**
 * Returns the standard dead-code reviewer.
 * @returns The dead-code reviewer policy.
 */
function deadCode(): ReviewerPolicy {
  const reviewer = STANDARD_REVIEW_MANIFEST.reviewers.find(candidate => candidate.id === 'dead-code')
  if (reviewer === undefined) throw new Error('missing dead-code reviewer')
  return reviewer
}

describe('assertReviewerPolicy', () => {
  test('accepts a standard reviewer', () => {
    expect(assertReviewerPolicy(deadCode(), 'test').id).toBe('dead-code')
  })

  test('rejects unknown fields and malformed nested values', () => {
    expect(() => assertReviewerPolicy({ ...deadCode(), extra: true }, 'test')).toThrow('unknown field "extra"')

    const badDetector = { ...deadCode(), detectors: [{ categories: 'nope', detector: 'knip' }] }
    expect(() => assertReviewerPolicy(badDetector, 'test')).toThrow('"categories" must be an array')

    const badConfidence = { ...deadCode(), threshold: { minimumConfidence: 'high', severity: 'info' } }
    expect(() => assertReviewerPolicy(badConfidence, 'test')).toThrow('"minimumConfidence" must be a finite number')

    const badDisposition = {
      ...deadCode(),
      outcomes: [{ category: 'x', destructive: false, disposition: 'maybe' }],
    }
    expect(() => assertReviewerPolicy(badDisposition, 'test')).toThrow('"disposition" must be one of')

    const duplicateOutcomes = {
      ...deadCode(),
      outcomes: [
        { category: 'dup', destructive: false, disposition: 'finding' },
        { category: 'dup', destructive: false, disposition: 'abstain' },
      ],
    }
    expect(() => assertReviewerPolicy(duplicateOutcomes, 'test')).toThrow('outcome categories must be unique')
  })
})

describe('assertReviewerOverlay', () => {
  test('rejects a non-object and unknown fields', () => {
    expect(() => assertReviewerOverlay('nope')).toThrow('overlay: must be an object')

    const withExtra = { extra: true, id: 'dead-code', mode: 'disable', reason: 'off' }
    expect(() => assertReviewerOverlay(withExtra)).toThrow('unknown field "extra"')
  })

  test('rejects a malformed nested patch on extend', () => {
    expect(() => assertReviewerOverlay({ id: 'dead-code', mode: 'extend', policy: { bogus: 1 } })).toThrow(
      'unknown field "bogus"',
    )
  })

  test('requires a reason to disable', () => {
    expect(() => assertReviewerOverlay({ id: 'dead-code', mode: 'disable' })).toThrow('disable requires a reason')
  })
})

describe('parseReviewerOverlays', () => {
  test('requires an array and validates every entry', () => {
    expect(() => parseReviewerOverlays({})).toThrow('"overlays" must be an array')
    expect(() => parseReviewerOverlays([{ id: 'x', mode: 'bogus' }])).toThrow('"mode" must be one of')
    expect(parseReviewerOverlays([{ id: 'dead-code', mode: 'disable', reason: 'off' }])).toHaveLength(1)
  })
})
