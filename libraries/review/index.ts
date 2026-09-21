/**
 * Shared, versioned code-review policy for the first-party ecosystem.
 *
 * Basis owns the durable opinion — stable reviewer ids, their questions,
 * evidence and abstention rules, structured outcomes, and reporting thresholds
 * — while consumers own execution (running detectors, calling models, and
 * publishing results). Repositories address standard reviewers by id through
 * local overlays; see {@link composeReviewPolicy}.
 */

export { composeReviewPolicy } from './compose'
export type { ComposeReviewPolicyOptions } from './compose'
export { STANDARD_REVIEW_FIXTURES } from './fixtures'
export {
  DEAD_CODE_REVIEWER_ID,
  PLACEHOLDER_DOCUMENTATION_REVIEWER_ID,
  REVIEW_OVERLAY_DIRECTORY,
  REVIEW_POLICY_SCHEMA_VERSION,
  STANDARD_REVIEW_POLICY_ID,
  TOOLING_CONFORMANCE_CHURN_REVIEWER_ID,
  WARNING_BASELINE_REGRESSION_REVIEWER_ID,
} from './ids'
export { STANDARD_REVIEW_MANIFEST } from './manifest'
export { STANDARD_REVIEWERS } from './reviewers'
export { DEAD_CODE_KNIP_CATEGORIES, deadCode } from './reviewers/deadCode'
export { placeholderDocumentation } from './reviewers/placeholderDocumentation'
export { toolingConformanceChurn } from './reviewers/toolingConformanceChurn'
export { warningBaselineRegression } from './reviewers/warningBaselineRegression'
export type {
  ContextRequirement,
  DetectorCategory,
  DetectorRequirement,
  DisabledReviewer,
  EffectiveReviewer,
  EffectiveReviewPolicy,
  EvidenceRequirement,
  ExecutionProfile,
  OutcomeDefinition,
  OverlayMode,
  ReportingThreshold,
  ReviewFixture,
  ReviewManifest,
  ReviewOutcome,
  ReviewerOverlay,
  ReviewerPolicy,
  ReviewerSource,
  Severity,
} from './types'
