/**
 * Runtime validation for reviewer policy.
 *
 * Policy is loaded from repository files, so TypeScript types are not a safety
 * boundary: every value that crosses this module is parsed from `unknown` and
 * either returned as a fully-shaped value or rejected with a `[basis/review]`
 * error. The composer invokes these validators before anything is executed.
 */

import type { ContextRequirement, DetectorRequirement, ExecutionProfile, OutcomeDefinition, OverlayMode, ReportingThreshold, ReviewDisposition, ReviewerOverlay, ReviewerPolicy, Severity, VerificationCheck } from './types'

/** Supported execution profiles. */
const EXECUTION_PROFILES: readonly ExecutionProfile[] = [
  'detector-then-adjudicate',
  'deterministic',
  'frontier-semantic',
  'local-semantic',
]

/** Supported context requirements. */
const CONTEXT_REQUIREMENTS: readonly ContextRequirement[] = [
  'changed-files',
  'changed-lines',
  'detector-finding',
  'direct-callers',
  'enclosing-scope',
  'package-manifest',
  'related-tests',
  'repository-search',
  'schemas',
]

/** Supported overlay modes. */
const OVERLAY_MODES: readonly OverlayMode[] = ['add', 'disable', 'extend', 'replace']

/** Supported review dispositions. */
const REVIEW_DISPOSITIONS: readonly ReviewDisposition[] = ['abstain', 'finding', 'no_finding', 'question']

/** Supported severities. */
const SEVERITIES: readonly Severity[] = ['error', 'info', 'warning']

/** Keys accepted on a full reviewer policy. */
const REVIEWER_POLICY_KEYS = [
  'context',
  'detectors',
  'executionProfile',
  'id',
  'instructions',
  'outcomes',
  'threshold',
  'title',
  'verification',
] as const

/** Keys accepted on a reviewer overlay. */
const REVIEWER_OVERLAY_KEYS = ['id', 'mode', 'policy', 'reason'] as const

/**
 * Raises a validation error with the shared prefix.
 * @param label Value being validated.
 * @param message Failure description.
 */
export function reviewPolicyError(label: string, message: string): never {
  throw new Error(`[basis/review] ${label}: ${message}`)
}

/**
 * Whether a value is a non-null, non-array object.
 * @param value Value to test.
 * @returns `true` for plain objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Rejects unknown keys so a typo cannot silently survive composition.
 * @param value Object to inspect.
 * @param allowed Allowed key set.
 * @param label Value being validated.
 */
const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) reviewPolicyError(label, `unknown field "${key}"`)
  }
}

/**
 * Requires a non-empty string.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @returns The string.
 */
const requireString = (value: unknown, label: string, field: string): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return reviewPolicyError(label, `"${field}" must be a non-empty string`)
}

/**
 * Requires an optional non-empty string.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @returns The string, or `undefined` when absent.
 */
const requireOptionalString = (value: unknown, label: string, field: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim().length > 0) return value
  return reviewPolicyError(label, `"${field}" must be a non-empty string when present`)
}

/**
 * Requires a finite number.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @returns The number.
 */
const requireNumber = (value: unknown, label: string, field: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return reviewPolicyError(label, `"${field}" must be a finite number`)
}

/**
 * Requires a boolean.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @returns The boolean.
 */
const requireBoolean = (value: unknown, label: string, field: string): boolean => {
  if (typeof value === 'boolean') return value
  return reviewPolicyError(label, `"${field}" must be a boolean`)
}

/**
 * Requires an array.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @returns The array.
 */
const requireArray = (value: unknown, label: string, field: string): unknown[] => {
  if (Array.isArray(value)) return value
  return reviewPolicyError(label, `"${field}" must be an array`)
}

/**
 * Requires a string drawn from a fixed set of choices.
 * @param value Candidate value.
 * @param label Value being validated.
 * @param field Field name.
 * @param allowed Allowed choices.
 * @returns The chosen value.
 */
const requireChoice = <T extends string>(
  value: unknown,
  label: string,
  field: string,
  allowed: readonly T[],
): T => {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  return reviewPolicyError(label, `"${field}" must be one of: ${allowed.join(', ')}`)
}

/**
 * Maps a validated array through an entry parser, so nested validation stays
 * index-aware and fail-closed.
 * @param value Candidate array.
 * @param label Value being validated.
 * @param field Field name.
 * @param parse Entry parser.
 * @returns The parsed entries.
 */
function mapEntries<T>(
  value: unknown,
  label: string,
  field: string,
  parse: (entry: unknown, index: number, label: string) => T,
): T[] {
  const entries = requireArray(value, label, field)
  const parsed: T[] = []
  for (let index = 0; index < entries.length; index += 1) {
    parsed.push(parse(entries[index], index, label))
  }
  return parsed
}

/**
 * Parses one context requirement.
 * @param entry Candidate entry.
 * @param index Entry index.
 * @param label Value being validated.
 * @returns The validated context requirement.
 */
function parseContextEntry(entry: unknown, index: number, label: string): ContextRequirement {
  return requireChoice(entry, label, `context[${index}]`, CONTEXT_REQUIREMENTS)
}

/**
 * Parses one detector category selector.
 * @param entry Candidate entry.
 * @param index Entry index.
 * @param label Value being validated.
 * @returns The validated category selector.
 */
function parseCategoryEntry(entry: unknown, index: number, label: string): string {
  return requireString(entry, label, `categories[${index}]`)
}

/**
 * Parses one detector requirement.
 * @param entry Candidate entry.
 * @param index Entry index.
 * @param label Value being validated.
 * @returns The validated detector requirement.
 */
function parseDetectorEntry(entry: unknown, index: number, label: string): DetectorRequirement {
  return assertDetectorRequirement(entry, `${label}.detectors[${index}]`)
}

/**
 * Parses one outcome definition.
 * @param entry Candidate entry.
 * @param index Entry index.
 * @param label Value being validated.
 * @returns The validated outcome.
 */
function parseOutcomeEntry(entry: unknown, index: number, label: string): OutcomeDefinition {
  return assertOutcomeDefinition(entry, `${label}.outcomes[${index}]`)
}

/**
 * Validates a detector requirement.
 * @param value Candidate value.
 * @param label Value being validated.
 * @returns The validated detector requirement.
 */
function assertDetectorRequirement(value: unknown, label: string): DetectorRequirement {
  if (!isRecord(value)) reviewPolicyError(label, 'must be an object')
  assertKnownKeys(value, ['categories', 'detector'], label)
  return {
    categories: mapEntries(value.categories, label, 'categories', parseCategoryEntry),
    detector: requireString(value.detector, label, 'detector'),
  }
}

/**
 * Validates one outcome definition.
 * @param value Candidate value.
 * @param label Value being validated.
 * @returns The validated outcome.
 */
function assertOutcomeDefinition(value: unknown, label: string): OutcomeDefinition {
  if (!isRecord(value)) reviewPolicyError(label, 'must be an object')
  assertKnownKeys(value, ['category', 'destructive', 'disposition'], label)
  return {
    category: requireString(value.category, label, 'category'),
    destructive: requireBoolean(value.destructive, label, 'destructive'),
    disposition: requireChoice(value.disposition, label, 'disposition', REVIEW_DISPOSITIONS),
  }
}

/**
 * Validates a reporting threshold.
 * @param value Candidate value.
 * @param label Value being validated.
 * @returns The validated threshold.
 */
function assertThreshold(value: unknown, label: string): ReportingThreshold {
  if (!isRecord(value)) reviewPolicyError(label, 'must be an object')
  assertKnownKeys(value, ['minimumConfidence', 'severity'], label)
  const minimumConfidence = requireNumber(value.minimumConfidence, label, 'minimumConfidence')
  if (minimumConfidence < 0 || minimumConfidence > 1) {
    reviewPolicyError(label, 'minimumConfidence must be within [0, 1]')
  }
  return {
    minimumConfidence,
    severity: requireChoice(value.severity, label, 'severity', SEVERITIES),
  }
}

/**
 * Validates a registered deterministic verification check.
 * @param value Candidate value.
 * @param label Value being validated.
 * @returns The validated verification check.
 */
function assertVerification(value: unknown, label: string): VerificationCheck {
  if (!isRecord(value)) reviewPolicyError(label, 'must be an object')
  assertKnownKeys(value, ['detector'], label)
  return { detector: requireString(value.detector, label, 'detector') }
}

/**
 * Validates a fully materialized reviewer policy.
 * @param value Candidate value, typically parsed from repository files.
 * @param label Value being validated.
 * @returns The validated reviewer policy.
 */
export function assertReviewerPolicy(value: unknown, label: string): ReviewerPolicy {
  if (!isRecord(value)) reviewPolicyError(label, 'must be a reviewer object')
  assertKnownKeys(value, REVIEWER_POLICY_KEYS, label)

  const context = mapEntries(value.context, label, 'context', parseContextEntry)
  const detectors = mapEntries(value.detectors, label, 'detectors', parseDetectorEntry)
  const executionProfile = requireChoice(value.executionProfile, label, 'executionProfile', EXECUTION_PROFILES)
  const id = requireString(value.id, label, 'id')
  const instructions = requireString(value.instructions, label, 'instructions')
  const outcomes = mapEntries(value.outcomes, label, 'outcomes', parseOutcomeEntry)
  const threshold = assertThreshold(value.threshold, `${label}.threshold`)
  const title = requireString(value.title, label, 'title')
  const verification =
    value.verification === undefined ? undefined : assertVerification(value.verification, `${label}.verification`)

  if (outcomes.length === 0) reviewPolicyError(label, 'must declare at least one outcome')
  const categories = outcomes.map(outcome => outcome.category)
  if (new Set(categories).size !== categories.length) {
    reviewPolicyError(label, 'outcome categories must be unique')
  }

  return {
    context,
    detectors,
    executionProfile,
    id,
    instructions,
    outcomes,
    threshold,
    title,
    ...(verification !== undefined && { verification }),
  }
}

/**
 * Validates a partial reviewer patch used by an `extend` overlay. Only present
 * fields are checked, and unknown fields are rejected.
 * @param value Candidate value.
 * @param label Value being validated.
 * @returns The validated patch.
 */
function assertReviewerPatch(value: unknown, label: string): Partial<ReviewerPolicy> {
  if (!isRecord(value)) reviewPolicyError(label, 'must be a reviewer patch object')
  assertKnownKeys(value, REVIEWER_POLICY_KEYS, label)

  const patch: Partial<ReviewerPolicy> = {}
  if (value.context !== undefined) {
    patch.context = mapEntries(value.context, label, 'context', parseContextEntry)
  }
  if (value.detectors !== undefined) {
    patch.detectors = mapEntries(value.detectors, label, 'detectors', parseDetectorEntry)
  }
  if (value.executionProfile !== undefined) {
    patch.executionProfile = requireChoice(value.executionProfile, label, 'executionProfile', EXECUTION_PROFILES)
  }
  if (value.id !== undefined) patch.id = requireString(value.id, label, 'id')
  if (value.instructions !== undefined) patch.instructions = requireString(value.instructions, label, 'instructions')
  if (value.outcomes !== undefined) {
    patch.outcomes = mapEntries(value.outcomes, label, 'outcomes', parseOutcomeEntry)
  }
  if (value.threshold !== undefined) patch.threshold = assertThreshold(value.threshold, `${label}.threshold`)
  if (value.title !== undefined) patch.title = requireString(value.title, label, 'title')
  if (value.verification !== undefined) {
    patch.verification = assertVerification(value.verification, `${label}.verification`)
  }
  return patch
}

/**
 * Validates a repository-local reviewer overlay.
 * @param value Candidate value, typically parsed from a repository file.
 * @returns The validated overlay.
 */
export function assertReviewerOverlay(value: unknown): ReviewerOverlay {
  if (!isRecord(value)) reviewPolicyError('overlay', 'must be an object')
  assertKnownKeys(value, REVIEWER_OVERLAY_KEYS, 'overlay')
  const id = requireString(value.id, 'overlay', 'id')
  const label = `overlay "${id}"`
  const mode = requireChoice(value.mode, label, 'mode', OVERLAY_MODES)
  const reason = requireOptionalString(value.reason, label, 'reason')

  if (mode === 'disable') {
    if (reason === undefined) reviewPolicyError(label, 'disable requires a reason')
    if (value.policy !== undefined) reviewPolicyError(label, 'disable must not carry a policy')
    return { id, mode, reason }
  }

  if (value.policy === undefined) reviewPolicyError(label, `${mode} requires a policy`)
  if (mode === 'extend') return { id, mode, policy: assertReviewerPatch(value.policy, label) }

  const policy = assertReviewerPolicy(value.policy, label)
  if (policy.id !== id) reviewPolicyError(label, `policy id "${policy.id}" does not match overlay id`)
  return { id, mode, policy }
}

/**
 * Validates an array of overlays, for example the parsed `.basis/reviewers`
 * files of a target repository.
 * @param value Candidate value.
 * @returns The validated overlays.
 */
export function parseReviewerOverlays(value: unknown): ReviewerOverlay[] {
  return mapEntries(value, 'overlays', 'overlays', raw => assertReviewerOverlay(raw))
}
