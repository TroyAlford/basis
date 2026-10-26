import type { OutcomeDefinition, ReviewDisposition, ReviewOutcomeSummary, ReviewResult } from './types'

/**
 * Projects a reviewer disposition onto the binary result used in review reports.
 *
 * Only `no_finding` passes. A `finding`, `question`, or `abstain` is not a pass;
 * the outcome category carries the reason code.
 * @param disposition - The reviewer's disposition.
 * @returns `pass` or `fail`.
 */
export function reviewResult(disposition: ReviewDisposition): ReviewResult {
  return disposition === 'no_finding' ? 'pass' : 'fail'
}

/**
 * Projects one reviewer outcome into the result and reason-code pair used in
 * report tables.
 * @param outcome - The outcome category and disposition.
 * @returns The binary result and its reason code.
 */
export function summarizeOutcome(
  outcome: Pick<OutcomeDefinition, 'category' | 'disposition'>,
): ReviewOutcomeSummary {
  return {
    reasonCode: outcome.category,
    result: reviewResult(outcome.disposition),
  }
}
