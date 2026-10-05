import { describe, expect, test } from 'bun:test'
import { REVIEW_POLICY_SCHEMA_VERSION, STANDARD_REVIEW_POLICY_ID } from './ids'
import { STANDARD_REVIEW_MANIFEST } from './manifest'

describe('standard review manifest', () => {
  test('is the versioned Basis standard', () => {
    expect(STANDARD_REVIEW_MANIFEST.id).toBe(STANDARD_REVIEW_POLICY_ID)
    expect(STANDARD_REVIEW_MANIFEST.schemaVersion).toBe(REVIEW_POLICY_SCHEMA_VERSION)
  })

  test('ships unique reviewer ids taken from front-matter', () => {
    const ids = STANDARD_REVIEW_MANIFEST.reviewers.map(reviewer => reviewer.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('dead-code')
  })

  test('every reviewer is a valid runtime policy', () => {
    for (const reviewer of STANDARD_REVIEW_MANIFEST.reviewers) {
      expect(reviewer.instructions.length).toBeGreaterThan(0)
      expect(reviewer.outcomes.length).toBeGreaterThan(0)
      expect(reviewer.threshold.minimumConfidence).toBeGreaterThanOrEqual(0)
      expect(reviewer.threshold.minimumConfidence).toBeLessThanOrEqual(1)
    }
  })

  test('dead-code declares a registered verification check', () => {
    const reviewer = STANDARD_REVIEW_MANIFEST.reviewers.find(candidate => candidate.id === 'dead-code')
    expect(reviewer?.verification).toEqual({ detector: 'knip' })
  })

  test('ships the accidental complexity semantic reviewer', () => {
    const reviewer = STANDARD_REVIEW_MANIFEST.reviewers
      .find(candidate => candidate.id === 'accidental-complexity')

    expect(reviewer?.executionProfile).toBe('local-semantic')
    expect(reviewer?.detectors).toEqual([])
    expect(reviewer?.outcomes.map(outcome => outcome.category)).toEqual([
      'simplify-mechanism',
      'use-existing-primitive',
      'remove-unnecessary-configuration',
      'question-complexity',
      'proportionate',
      'abstain',
    ])
  })

  test('ships the component style semantics semantic reviewer', () => {
    const reviewer = STANDARD_REVIEW_MANIFEST.reviewers
      .find(candidate => candidate.id === 'component-style-semantics')

    expect(reviewer?.executionProfile).toBe('local-semantic')
    expect(reviewer?.detectors).toEqual([])
    expect(reviewer?.outcomes.map(outcome => outcome.category)).toEqual([
      'state-semantics',
      'synthetic-accessibility',
      'shared-typed-state',
      'nesting-ownership',
      'cross-component-coupling',
      'clear',
      'abstain',
    ])
  })
})
