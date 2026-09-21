import { TOOLING_CONFORMANCE_CHURN_REVIEWER_ID } from '../ids'
import type { ReviewerPolicy } from '../types'

/** Standard policy for source churn that only satisfies tooling. */
export const toolingConformanceChurn: ReviewerPolicy = {
  context: ['changed-files', 'changed-lines', 'enclosing-scope'],
  detectors: [
    {
      categories: [],
      detector: 'diff-facts',
    },
  ],
  evidence: [
    {
      id: 'behavior',
      requirement: 'Why each non-trivial change is or is not behavior-preserving.',
    },
    {
      id: 'diff',
      requirement: 'The full diff, labelled with the tooling change it accompanies.',
    },
  ],
  executionProfile: 'local-semantic',
  id: TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
  instructions: 'Flag churn that exists only to satisfy tooling on a narrow migration.',
  outOfScope: [
    'Formatting, import, and style changes required by the adopted standard.',
    'Behavior changes the tooling migration intentionally requires.',
    'Changes to files the tooling change does not touch.',
  ],
  outcomes: [
    {
      category: 'conformance-churn',
      description: 'The diff contains semantic-looking churn unrelated to the tooling change.',
      destructive: false,
      outcome: 'finding',
    },
    {
      category: 'necessary-change',
      description: 'The change is required by the adopted standard or is behavior-preserving.',
      destructive: false,
      outcome: 'no_finding',
    },
    {
      category: 'abstain',
      description: 'The scope of the tooling change is unclear from the supplied evidence.',
      destructive: false,
      outcome: 'abstain',
    },
  ],
  question: 'For a narrowly scoped tooling change, does the diff add churn that only exists to satisfy tooling?',
  threshold: { minimumConfidence: 0.8, severity: 'info' },
  title: 'Tooling conformance churn',
}
