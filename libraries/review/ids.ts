/**
 * Stable identifiers and versions for the shared Basis review policy.
 *
 * Reviewer ids are contractual: repository-local overlays address standard
 * reviewers by these ids, so they must never be renamed without a schema bump.
 */

/** Manifest id for the shared Basis standard policy. */
export const STANDARD_REVIEW_POLICY_ID = 'basis-standard'

/** Schema version of the reviewer-policy format. */
export const REVIEW_POLICY_SCHEMA_VERSION = 1

/** Conventional repository-local overlay directory. */
export const REVIEW_OVERLAY_DIRECTORY = '.basis/reviewers'

/** Reviewer id for placeholder documentation added only to satisfy a rule. */
export const PLACEHOLDER_DOCUMENTATION_REVIEWER_ID = 'placeholder-documentation'

/** Reviewer id for a newly normalized or increased warning baseline. */
export const WARNING_BASELINE_REGRESSION_REVIEWER_ID = 'warning-baseline-regression'

/** Reviewer id for source churn that only satisfies tooling. */
export const TOOLING_CONFORMANCE_CHURN_REVIEWER_ID = 'tooling-conformance-churn'

/** Reviewer id for the diff-scoped dead-code reviewer. */
export const DEAD_CODE_REVIEWER_ID = 'dead-code'
