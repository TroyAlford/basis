import { REVIEW_POLICY_SCHEMA_VERSION, STANDARD_REVIEW_POLICY_ID } from './ids'
import { STANDARD_REVIEWERS } from './STANDARD_REVIEWERS'
import type { ReviewManifest } from './types'

/** The versioned standard review policy shipped with Basis. */
export const STANDARD_REVIEW_MANIFEST: ReviewManifest = {
  id: STANDARD_REVIEW_POLICY_ID,
  reviewers: STANDARD_REVIEWERS,
  schemaVersion: REVIEW_POLICY_SCHEMA_VERSION,
}
