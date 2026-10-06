import { describe, expect, test } from 'bun:test'
import { ChangeType, isMinorChange, isNoChange, isPatchChange } from './getUnreleasedCommitMessages'

/** The release bump a single conventional-commit type produces on its own. */
type Bump = 'minor' | 'none' | 'patch'

/**
 * The type -> bump matrix. Every conventional-commit type falls into exactly
 * one bucket. A major bump is reserved for breaking changes (`!` after the
 * type, or `BREAKING CHANGE` in the body), independent of the type itself.
 */
const matrix: [ChangeType, Bump][] = [
  [ChangeType.Build, 'none'],
  [ChangeType.CI, 'none'],
  [ChangeType.Chore, 'patch'],
  [ChangeType.Docs, 'none'],
  [ChangeType.Feat, 'minor'],
  [ChangeType.Fix, 'patch'],
  [ChangeType.Perf, 'minor'],
  [ChangeType.Refactor, 'patch'],
  [ChangeType.Revert, 'patch'],
  [ChangeType.Style, 'patch'],
  [ChangeType.Test, 'patch'],
  [ChangeType.Unknown, 'none'],
]

describe('type -> bump matrix', () => {
  test('covers every conventional-commit type', () => {
    expect(matrix.map(([type]) => type).sort()).toEqual(Object.values(ChangeType).sort())
  })

  test.each(matrix)('%s commits bump %s', (type, bump) => {
    expect(isMinorChange(type)).toBe(bump === 'minor')
    expect(isPatchChange(type)).toBe(bump === 'patch')
    expect(isNoChange(type)).toBe(bump === 'none')
  })

  test('classifies each type into exactly one bucket', () => {
    for (const type of Object.values(ChangeType)) {
      const matches = [isMinorChange(type), isPatchChange(type), isNoChange(type)].filter(Boolean)
      expect({ matches: matches.length, type }).toEqual({ matches: 1, type })
    }
  })
})
