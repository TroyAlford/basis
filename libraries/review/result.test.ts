import { describe, expect, test } from 'bun:test'
import { reviewResult, summarizeOutcome } from './result'

describe('reviewResult', () => {
  test('passes only a no-finding disposition', () => {
    expect(reviewResult('no_finding')).toBe('pass')
  })

  test('fails findings, questions, and abstentions', () => {
    expect(reviewResult('finding')).toBe('fail')
    expect(reviewResult('question')).toBe('fail')
    expect(reviewResult('abstain')).toBe('fail')
  })
})

describe('summarizeOutcome', () => {
  test('carries the outcome category as the reason code', () => {
    expect(summarizeOutcome({ category: 'proportionate', disposition: 'no_finding' })).toEqual({
      reasonCode: 'proportionate',
      result: 'pass',
    })
    expect(summarizeOutcome({
      category: 'expensive-critical-coverage',
      disposition: 'finding',
    })).toEqual({
      reasonCode: 'expensive-critical-coverage',
      result: 'fail',
    })
  })
})
