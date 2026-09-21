/**
 * Shared, versioned code-review policy for the first-party ecosystem.
 *
 * The canonical form of a reviewer is a Markdown document: mechanical metadata
 * in the YAML front-matter and the engineering principle, reasoning, and
 * instructions in the body. This module exposes the resulting typed runtime
 * representation. Basis owns policy only — running detectors, calling models,
 * repairing code, and publishing reviews belong to the consumer.
 */

export { composeReviewPolicy } from './compose'
export type { ComposeReviewPolicyOptions } from './compose'
export { STANDARD_REVIEW_FIXTURES } from './fixtures'
export {
  REVIEW_OVERLAY_DIRECTORY,
  REVIEW_POLICY_SCHEMA_VERSION,
  STANDARD_REVIEW_POLICY_ID,
} from './ids'
export { loadOverlayDirectory, loadReviewerDirectory } from './load'
export { STANDARD_REVIEW_MANIFEST } from './manifest'
export { parseFrontMatter, parseReviewerOverlaySource, parseReviewerSource } from './markdown'
export { STANDARD_REVIEWERS } from './STANDARD_REVIEWERS'
export type {
  ContextRequirement,
  DetectorRequirement,
  DisabledReviewer,
  EffectiveReviewer,
  EffectiveReviewPolicy,
  ExecutionProfile,
  OutcomeDefinition,
  OverlayMode,
  ReportingThreshold,
  ReviewDisposition,
  ReviewFixture,
  ReviewManifest,
  ReviewerOverlay,
  ReviewerPolicy,
  ReviewerSource,
  Severity,
} from './types'
export { assertReviewerOverlay, assertReviewerPolicy, parseReviewerOverlays } from './validate'
