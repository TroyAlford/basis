import { STANDARD_REVIEW_MANIFEST } from './manifest'
import type { DisabledReviewer, EffectiveReviewer, EffectiveReviewPolicy, ExecutionProfile, OverlayMode, ReviewerOverlay, ReviewerPolicy, ReviewManifest, Severity } from './types'

/** Execution profiles a reviewer may declare. */
const EXECUTION_PROFILES: readonly ExecutionProfile[] = [
  'detector-then-adjudicate',
  'deterministic',
  'frontier-semantic',
  'local-semantic',
]

/** Overlay modes a repository may use. */
const OVERLAY_MODES: readonly OverlayMode[] = ['add', 'disable', 'extend', 'replace']

/** Fields an `add`/`replace` overlay must supply in full. */
const REQUIRED_POLICY_FIELDS = [
  'context',
  'detectors',
  'evidence',
  'executionProfile',
  'id',
  'instructions',
  'outcomes',
  'outOfScope',
  'question',
  'threshold',
  'title',
] as const

/** Severities a reviewer may report. */
const SEVERITIES: readonly Severity[] = ['error', 'info', 'warning']

/** A reviewer id. */
type ReviewerId = string

/** Options for composing an effective review policy. */
export interface ComposeReviewPolicyOptions {
  /** Basis release version recorded for provenance, when known. */
  basisVersion?: string,
  /** Repository-local overlays to apply, in any order. */
  overlays?: readonly ReviewerOverlay[],
  /** Standard manifest to compose from; defaults to the Basis standard. */
  standard?: ReviewManifest,
}

/**
 * Raises a composition error with the shared prefix.
 * @param message Failure description.
 */
const fail = (message: string): never => {
  throw new Error(`[basis/review] ${message}`)
}

/**
 * Orders two reviewer ids deterministically.
 * @param a Left id.
 * @param b Right id.
 * @returns Negative or positive ordering value.
 */
const compareIds = (a: ReviewerId, b: ReviewerId): number => (a < b ? -1 : 1)

/**
 * Validates a fully materialized reviewer policy.
 * @param policy Reviewer policy to validate.
 */
const assertValidReviewer = (policy: ReviewerPolicy): void => {
  if (policy.id.trim().length === 0) fail('a reviewer has an empty id')
  if (policy.title.trim().length === 0) fail(`reviewer "${policy.id}" has an empty title`)
  if (policy.question.trim().length === 0) fail(`reviewer "${policy.id}" has an empty question`)
  if (!EXECUTION_PROFILES.includes(policy.executionProfile)) {
    fail(`reviewer "${policy.id}" has an unknown execution profile`)
  }
  if (!SEVERITIES.includes(policy.threshold.severity)) {
    fail(`reviewer "${policy.id}" has an unknown severity`)
  }
  const confidence = policy.threshold.minimumConfidence
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail(`reviewer "${policy.id}" minimumConfidence must be within [0, 1]`)
  }
  if (policy.outcomes.length === 0) fail(`reviewer "${policy.id}" has no outcomes`)
}

/**
 * Materializes and validates a full reviewer policy from an overlay.
 * @param overlay Overlay carrying a full policy for `add`/`replace`.
 * @returns The validated reviewer policy.
 */
const toReviewerPolicy = (overlay: ReviewerOverlay): ReviewerPolicy => {
  const partial = overlay.policy
  if (partial === undefined) fail(`overlay "${overlay.id}" (${overlay.mode}) requires a policy`)
  for (const field of REQUIRED_POLICY_FIELDS) {
    if (partial[field] === undefined) fail(`overlay "${overlay.id}" is missing "${field}"`)
  }
  const policy = partial as ReviewerPolicy
  if (policy.id !== overlay.id) {
    fail(`overlay targets "${overlay.id}" but its policy id is "${policy.id}"`)
  }
  assertValidReviewer(policy)
  return policy
}

/**
 * Merges an `extend` overlay into a base reviewer. Scalar fields are replaced;
 * array fields are appended, so a repository adds rules without restating them.
 * @param base Standard reviewer being extended.
 * @param overlay Partial policy supplied by the repository.
 * @returns The merged reviewer policy.
 */
const mergeReviewer = (base: ReviewerPolicy, overlay: Partial<ReviewerPolicy>): ReviewerPolicy => {
  const verification = overlay.verification ?? base.verification
  const merged: ReviewerPolicy = {
    context: [...base.context, ...(overlay.context ?? [])],
    detectors: [...base.detectors, ...(overlay.detectors ?? [])],
    evidence: [...base.evidence, ...(overlay.evidence ?? [])],
    executionProfile: overlay.executionProfile ?? base.executionProfile,
    id: base.id,
    instructions: overlay.instructions ?? base.instructions,
    outOfScope: [...base.outOfScope, ...(overlay.outOfScope ?? [])],
    outcomes: [...base.outcomes, ...(overlay.outcomes ?? [])],
    question: overlay.question ?? base.question,
    threshold: overlay.threshold ?? base.threshold,
    title: overlay.title ?? base.title,
    ...(verification !== undefined && { verification }),
  }
  assertValidReviewer(merged)
  return merged
}

/**
 * Applies one overlay to the working reviewer map.
 * @param reviewers Mutable reviewer map keyed by id.
 * @param disabled Collector for disabled reviewers.
 * @param overlay Overlay to apply.
 */
const applyOverlay = (
  reviewers: Map<ReviewerId, EffectiveReviewer>,
  disabled: DisabledReviewer[],
  overlay: ReviewerOverlay,
): void => {
  const existing = reviewers.get(overlay.id)
  switch (overlay.mode) {
    case 'add': {
      if (existing !== undefined) fail(`cannot add reviewer "${overlay.id}": it already exists`)
      reviewers.set(overlay.id, { policy: toReviewerPolicy(overlay), source: 'repo-local' })
      return
    }
    case 'disable': {
      if (existing === undefined) fail(`cannot disable reviewer "${overlay.id}": it is not defined`)
      if (overlay.policy !== undefined) {
        fail(`disable overlay for "${overlay.id}" must not carry a policy`)
      }
      const reason = overlay.reason?.trim()
      if (reason === undefined || reason.length === 0) {
        fail(`disable overlay for "${overlay.id}" requires a reason`)
      }
      disabled.push({ id: overlay.id, reason, source: existing.source })
      reviewers.delete(overlay.id)
      return
    }
    case 'extend': {
      if (existing === undefined) fail(`cannot extend reviewer "${overlay.id}": it is not defined`)
      reviewers.set(overlay.id, {
        policy: mergeReviewer(existing.policy, overlay.policy ?? {}),
        source: existing.source,
      })
      return
    }
    case 'replace': {
      if (existing === undefined) fail(`cannot replace reviewer "${overlay.id}": it is not defined`)
      reviewers.set(overlay.id, { policy: toReviewerPolicy(overlay), source: 'repo-local' })
      return
    }
  }
}

/**
 * Composes the standard manifest with repository-local overlays into the
 * effective reviewer policy. Composition is keyed by stable reviewer id, so it
 * never depends on filename or overlay order.
 * @param options Composition options.
 * @returns The effective review policy.
 */
export const composeReviewPolicy = (
  options: ComposeReviewPolicyOptions = {},
): EffectiveReviewPolicy => {
  const { basisVersion, overlays = [], standard = STANDARD_REVIEW_MANIFEST } = options

  const reviewers = new Map<ReviewerId, EffectiveReviewer>()
  for (const policy of standard.reviewers) {
    assertValidReviewer(policy)
    if (reviewers.has(policy.id)) fail(`duplicate standard reviewer id "${policy.id}"`)
    reviewers.set(policy.id, { policy, source: 'basis-standard' })
  }

  const disabled: DisabledReviewer[] = []
  const seen = new Set<ReviewerId>()
  for (const overlay of overlays) {
    if (!OVERLAY_MODES.includes(overlay.mode)) fail(`overlay "${overlay.id}" has an unknown mode`)
    if (seen.has(overlay.id)) fail(`duplicate overlay for reviewer "${overlay.id}"`)
    seen.add(overlay.id)
    applyOverlay(reviewers, disabled, overlay)
  }

  return {
    ...(basisVersion !== undefined && { basisVersion }),
    disabled: [...disabled].sort((a, b) => compareIds(a.id, b.id)),
    id: standard.id,
    reviewers: [...reviewers.values()].sort((a, b) => compareIds(a.policy.id, b.policy.id)),
    schemaVersion: standard.schemaVersion,
  }
}
