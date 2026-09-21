import { describe, expect, test } from 'bun:test'
import { composeReviewPolicy } from './compose'
import { STANDARD_REVIEW_MANIFEST } from './manifest'
import type { ReviewerPolicy } from './types'

/**
 * Returns the standard dead-code reviewer.
 * @returns The dead-code reviewer policy.
 */
function deadCode(): ReviewerPolicy {
  const reviewer = STANDARD_REVIEW_MANIFEST.reviewers.find(candidate => candidate.id === 'dead-code')
  if (reviewer === undefined) throw new Error('missing dead-code reviewer')
  return reviewer
}

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
    const effective = composeReviewPolicy({
      overlays: [{ id: 'repo/extra', mode: 'add', policy: { ...deadCode(), id: 'repo/extra' } }],
    })

    expect(effective.reviewers.find(reviewer => reviewer.policy.id === 'repo/extra')?.sources).toEqual([
      'repo-local',
    ])
  })

  test('extend appends instructions and arrays, replaces scalars, and keeps both sources', () => {
    const base = deadCode()
    const effective = composeReviewPolicy({
      overlays: [
        {
          id: 'dead-code',
          mode: 'extend',
          policy: {
            instructions: 'Local guidance.',
            threshold: { minimumConfidence: 0.9, severity: 'error' },
          },
        },
      ],
    })

    const reviewer = effective.reviewers.find(candidate => candidate.policy.id === 'dead-code')
    expect(reviewer?.policy.instructions.startsWith(base.instructions)).toBe(true)
    expect(reviewer?.policy.instructions.endsWith('Local guidance.')).toBe(true)
    expect(reviewer?.policy.threshold).toEqual({ minimumConfidence: 0.9, severity: 'error' })
    expect(reviewer?.sources).toEqual(['basis-standard', 'repo-local'])
  })

  test('replaces a reviewer entirely', () => {
    const effective = composeReviewPolicy({
      overlays: [{ id: 'dead-code', mode: 'replace', policy: { ...deadCode(), title: 'Repo dead code' } }],
    })

    const reviewer = effective.reviewers.find(candidate => candidate.policy.id === 'dead-code')
    expect(reviewer?.policy.title).toBe('Repo dead code')
    expect(reviewer?.sources).toEqual(['repo-local'])
  })

  test('disables a reviewer and keeps its provenance', () => {
    const effective = composeReviewPolicy({
      overlays: [{ id: 'dead-code', mode: 'disable', reason: 'Handled elsewhere.' }],
    })

    expect(effective.reviewers.some(reviewer => reviewer.policy.id === 'dead-code')).toBe(false)
    expect(effective.disabled).toEqual([{ id: 'dead-code', reason: 'Handled elsewhere.', sources: ['basis-standard'] }])
  })

  test('is independent of overlay order', () => {
    const forward = composeReviewPolicy({
      overlays: [
        { id: 'dead-code', mode: 'disable', reason: 'off' },
        { id: 'repo/extra', mode: 'add', policy: { ...deadCode(), id: 'repo/extra' } },
      ],
    })
    const reverse = composeReviewPolicy({
      overlays: [
        { id: 'repo/extra', mode: 'add', policy: { ...deadCode(), id: 'repo/extra' } },
        { id: 'dead-code', mode: 'disable', reason: 'off' },
      ],
    })

    expect(reverse).toEqual(forward)
  })
})

describe('composeReviewPolicy validation', () => {
  test('rejects duplicate overlays for the same reviewer', () => {
    expect(() => composeReviewPolicy({
      overlays: [
        { id: 'dead-code', mode: 'disable', reason: 'first' },
        { id: 'dead-code', mode: 'disable', reason: 'second' },
      ],
    })).toThrow('duplicate overlay')
  })

  test('rejects adding a reviewer that already exists', () => {
    expect(() => composeReviewPolicy({ overlays: [{ id: 'dead-code', mode: 'add', policy: deadCode() }] }))
      .toThrow('cannot add reviewer')
  })

  test('rejects extending, replacing, or disabling an unknown reviewer', () => {
    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'extend', policy: {} }] })).toThrow(
      'cannot extend reviewer',
    )

    const replacement = { ...deadCode(), id: 'ghost' }
    expect(() => composeReviewPolicy({ overlays: [{ id: 'ghost', mode: 'replace', policy: replacement }] })).toThrow(
      'cannot replace reviewer',
    )

    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'disable', reason: 'x' }] })).toThrow(
      'cannot disable reviewer',
    )
  })

  test('requires a reason to disable and forbids a policy payload', () => {
    expect(() => composeReviewPolicy({ overlays: [{ id: 'dead-code', mode: 'disable' }] })).toThrow(
      'disable requires a reason',
    )
    expect(() => composeReviewPolicy({
      overlays: [{ id: 'dead-code', mode: 'disable', policy: deadCode(), reason: 'x' }],
    })).toThrow('disable must not carry a policy')
  })

  test('rejects an overlay whose policy id does not match and unknown fields', () => {
    expect(() => composeReviewPolicy({
      overlays: [{ id: 'repo/extra', mode: 'add', policy: { ...deadCode(), id: 'repo/other' } }],
    })).toThrow('does not match overlay id')

    expect(() => composeReviewPolicy({ overlays: [{ bogus: true, id: 'dead-code', mode: 'disable', reason: 'x' }] }))
      .toThrow('unknown field "bogus"')
  })

  test('rejects a missing required field, an unknown mode, and out-of-range values', () => {
    expect(() => composeReviewPolicy({
      overlays: [
        { id: 'repo/extra', mode: 'add', policy: { ...deadCode(), id: 'repo/extra', title: undefined } },
      ],
    })).toThrow('"title" must be a non-empty string')

    expect(() => composeReviewPolicy({ overlays: [{ id: 'nope', mode: 'x' }] })).toThrow('"mode" must be one of')

    expect(() => composeReviewPolicy({
      overlays: [
        {
          id: 'repo/extra',
          mode: 'add',
          policy: {
            ...deadCode(),
            id: 'repo/extra',
            threshold: { minimumConfidence: 5, severity: 'warning' },
          },
        },
      ],
    })).toThrow('minimumConfidence must be within [0, 1]')
  })
})
