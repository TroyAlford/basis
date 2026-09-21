import type { ReviewerPolicy } from '../types'
import { deadCode } from './deadCode'
import { placeholderDocumentation } from './placeholderDocumentation'
import { toolingConformanceChurn } from './toolingConformanceChurn'
import { warningBaselineRegression } from './warningBaselineRegression'

/** The standard reviewers every conforming repository inherits from Basis. */
export const STANDARD_REVIEWERS: readonly ReviewerPolicy[] = [
  placeholderDocumentation,
  warningBaselineRegression,
  toolingConformanceChurn,
  deadCode,
]
