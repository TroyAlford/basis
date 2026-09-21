import { describe, expect, test } from 'bun:test'
import { composeReviewPolicy } from './compose'
import { DEAD_CODE_REVIEWER_ID, TOOLING_CONFORMANCE_CHURN_REVIEWER_ID } from './ids'
import { STANDARD_REVIEW_MANIFEST } from './manifest'

describe('composeReviewPolicy', () => {
  test('returns the standard reviewers with Basis provenance', () => {
    const effective = composeReviewPolicy()
    expect(effective.id).toBe(STANDARD_REVIEW_MANIFEST.id)
    expect(effective.schemaVersion).toBe(STANDARD_REVIEW_MANIFEST.schemaVersion)
    expect(effective.reviewers).toHaveLength(STANDARD_REVIEW_MANIFEST.reviewers.length)
    expect(effective.reviewers.every(reviewer => reviewer.sources.join() === 'basis-standard')).toBe(true)
    expect(effective.disabled).toEqual([])
    expect(effective.basisVersion).toBeUndefined()
  })

  test('records the Basis version when supplied', () => {
    expect(composeReviewPolicy({ basisVersion: 'v3.26.0' }).basisVersion).toBe('v3.26.0')
  })

  test('returns reviewers sorted by stable id', () => {
    const ids = composeReviewPolicy().reviewers.map(reviewer => reviewer.policy.id)
    expect(ids).toEqual([...ids].sort())
  })

  test('adds a repository-local reviewer', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    const effective = composeReviewPolicy({
      overlays: [{ id: 'repo/extra', mode: 'add', policy: { ...base, id: 'repo/extra' } }],
    })

    const added = effective.reviewers.find(reviewer => reviewer.policy.id === 'repo/extra')
    expect(added?.sources).toEqual(['repo-local'])
  })

  test('extends arrays, replaces scalars, and keeps both provenances', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    const effective = composeReviewPolicy({
      overlays: [
        {
          id: DEAD_CODE_REVIEWER_ID,
          mode: 'extend',
          policy: {
            outOfScope: ['Generated migration modules.'],
            threshold: { minimumConfidence: 0.9, severity: 'error' },
            verification: 'Re-run knip twice.',
          },
        },
      ],
    })

    const reviewer = effective.reviewers.find(candidate => candidate.policy.id === DEAD_CODE_REVIEWER_ID)
    expect(reviewer?.policy.outOfScope).toContain('Generated migration modules.')
    expect(reviewer?.policy.outOfScope).toHaveLength(base.outOfScope.length + 1)
    expect(reviewer?.policy.threshold).toEqual({ minimumConfidence: 0.9, severity: 'error' })
    expect(reviewer?.policy.verification).toBe('Re-run knip twice.')
    expect(reviewer?.sources).toEqual(['basis-standard', 'repo-local'])
  })

  test('replaces a reviewer entirely', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    const effective = composeReviewPolicy({
      overlays: [
        {
          id: DEAD_CODE_REVIEWER_ID,
          mode: 'replace',
          policy: { ...base, title: 'Repository dead code' },
        },
      ],
    })

    const reviewer = effective.reviewers.find(candidate => candidate.policy.id === DEAD_CODE_REVIEWER_ID)
    expect(reviewer?.policy.title).toBe('Repository dead code')
    expect(reviewer?.sources).toEqual(['repo-local'])
  })

  test('disables a reviewer and keeps its provenance', () => {
    const effective = composeReviewPolicy({
      overlays: [
        {
          id: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
          mode: 'disable',
          reason: 'No tooling migrations in this repository.',
        },
      ],
    })

    expect(
      effective.reviewers.some(reviewer => reviewer.policy.id === TOOLING_CONFORMANCE_CHURN_REVIEWER_ID),
    ).toBe(false)
    expect(effective.disabled).toEqual([
      {
        id: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
        reason: 'No tooling migrations in this repository.',
        sources: ['basis-standard'],
      },
    ])
  })

  test('is independent of overlay order', () => {
    const forward = composeReviewPolicy({
      overlays: [
        { id: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID, mode: 'disable', reason: 'none in this repository' },
        { id: DEAD_CODE_REVIEWER_ID, mode: 'extend', policy: { outOfScope: ['Generated code.'] } },
      ],
    })
    const reverse = composeReviewPolicy({
      overlays: [
        { id: DEAD_CODE_REVIEWER_ID, mode: 'extend', policy: { outOfScope: ['Generated code.'] } },
        { id: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID, mode: 'disable', reason: 'none in this repository' },
      ],
    })

    expect(reverse).toEqual(forward)
  })
})

describe('composeReviewPolicy validation', () => {
  test('rejects duplicate overlays for the same reviewer', () => {
    expect(() => composeReviewPolicy({
      overlays: [
        { id: DEAD_CODE_REVIEWER_ID, mode: 'disable', reason: 'first' },
        { id: DEAD_CODE_REVIEWER_ID, mode: 'disable', reason: 'second' },
      ],
    })).toThrow('duplicate overlay')
  })

  test('rejects adding a reviewer that already exists', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    expect(() => composeReviewPolicy({
      overlays: [{ id: DEAD_CODE_REVIEWER_ID, mode: 'add', policy: { ...base } }],
    })).toThrow('cannot add reviewer')
  })

  test('rejects extending, replacing, or disabling an unknown reviewer', () => {
    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'extend', policy: {} }] })).toThrow(
      'cannot extend reviewer',
    )
    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'disable', reason: 'x' }] })).toThrow(
      'cannot disable reviewer',
    )
  })

  test('requires a reason to disable and forbids a policy payload', () => {
    expect(() => composeReviewPolicy({ overlays: [{ id: DEAD_CODE_REVIEWER_ID, mode: 'disable' }] })).toThrow(
      'disable requires a reason',
    )

    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    expect(() => composeReviewPolicy({
      overlays: [{ id: DEAD_CODE_REVIEWER_ID, mode: 'disable', policy: base, reason: 'x' }],
    })).toThrow('disable must not carry a policy')
  })

  test('rejects an overlay whose policy id does not match', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    expect(() => composeReviewPolicy({
      overlays: [{ id: 'repo/extra', mode: 'add', policy: { ...base, id: 'repo/other' } }],
    })).toThrow('does not match overlay id')
  })

  test('rejects a missing required field and out-of-range values', () => {
    const base = STANDARD_REVIEW_MANIFEST.reviewers.find(reviewer => reviewer.id === DEAD_CODE_REVIEWER_ID)
    if (base === undefined) throw new Error('missing dead-code reviewer')

    expect(() => composeReviewPolicy({
      overlays: [{ id: 'repo/extra', mode: 'add', policy: { ...base, id: 'repo/extra', title: undefined } }],
    })).toThrow('"title" must be a non-empty string')

    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'x' }] })).toThrow('"mode" must be one of')

    expect(() => composeReviewPolicy({
      overlays: [
        {
          id: 'repo/extra',
          mode: 'add',
          policy: { ...base, id: 'repo/extra', threshold: { minimumConfidence: 5, severity: 'warning' } },
        },
      ],
    })).toThrow('minimumConfidence must be within [0, 1]')
  })
})
