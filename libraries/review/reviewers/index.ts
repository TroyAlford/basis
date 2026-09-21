import { loadReviewerDirectory } from '../load'
import type { ReviewerPolicy } from '../types'

/** The standard reviewers every conforming repository inherits from Basis. */
export const STANDARD_REVIEWERS: readonly ReviewerPolicy[] = loadReviewerDirectory(import.meta.dir)
