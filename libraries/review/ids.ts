/**
 * Platform and schema constants for the shared Basis review policy.
 *
 * Stable reviewer ids deliberately live only in the reviewer Markdown
 * front-matter — there is no second registry here. Adding a reviewer is adding
 * a document, not editing this file.
 */

/** Manifest id for the shared Basis standard policy. */
export const STANDARD_REVIEW_POLICY_ID = 'basis-standard'

/** Schema version of the reviewer-policy format. */
export const REVIEW_POLICY_SCHEMA_VERSION = 1

/** Conventional repository-local overlay directory. */
export const REVIEW_OVERLAY_DIRECTORY = '.basis/reviewers'
