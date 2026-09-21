import { STANDARD_REVIEW_MANIFEST } from './manifest'
import type { DisabledReviewer, EffectiveReviewer, EffectiveReviewPolicy, ReviewerOverlay, ReviewerPolicy, ReviewerSource, ReviewManifest } from './types'
import { assertReviewerOverlay, assertReviewerPolicy } from './validate'

/** A reviewer id. */
type ReviewerId = string

/** Options for composing an effective review policy. */
export interface ComposeReviewPolicyOptions {
  /** Basis release version recorded for provenance, when known. */
  basisVersion?: string,
  /** Repository-local overlays, typically parsed from repository files. */
  overlays?: readonly unknown[],
  /** Standard manifest to compose from; defaults to the Basis standard. */
  standard?: ReviewManifest,
}

/**
 * Raises a composition error with the shared prefix.
 * @param message Failure description.
 */
function fail(message: string): never {
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
 * Adds a source to a provenance list without duplicating it.
 * @param sources Existing sources.
 * @param source Source to add.
 * @returns The new provenance list.
 */
const withSource = (sources: readonly ReviewerSource[], source: ReviewerSource): ReviewerSource[] => {
  const next = [...sources]
  if (!next.includes(source)) next.push(source)
  return next
}

/**
 * Merges an `extend` patch into a base reviewer. Scalar fields are replaced and
 * array fields are appended; `instructions` are appended so repository guidance
 * extends the standard policy instead of replacing it. The merged result is
 * re-validated so composition stays fail-closed.
 * @param base Standard reviewer being extended.
 * @param patch Validated partial policy supplied by the repository.
 * @returns The merged reviewer policy.
 */
const mergeReviewer = (base: ReviewerPolicy, patch: Partial<ReviewerPolicy>): ReviewerPolicy => {
  const verification = patch.verification ?? base.verification
  const instructions =
    patch.instructions === undefined ? base.instructions : `${base.instructions}\n\n${patch.instructions}`
  return assertReviewerPolicy(
    {
      context: [...base.context, ...(patch.context ?? [])],
      detectors: [...base.detectors, ...(patch.detectors ?? [])],
      executionProfile: patch.executionProfile ?? base.executionProfile,
      id: base.id,
      instructions,
      outcomes: [...base.outcomes, ...(patch.outcomes ?? [])],
      threshold: patch.threshold ?? base.threshold,
      title: patch.title ?? base.title,
      ...(verification !== undefined && { verification }),
    },
    `reviewer "${base.id}"`,
  )
}

/**
 * Applies one validated overlay to the working reviewer map.
 * @param reviewers Mutable reviewer map keyed by id.
 * @param disabled Collector for disabled reviewers.
 * @param overlay Validated overlay to apply.
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
      reviewers.set(overlay.id, {
        policy: overlay.policy as ReviewerPolicy,
        sources: ['repo-local'],
      })
      return
    }
    case 'disable': {
      if (existing === undefined) fail(`cannot disable reviewer "${overlay.id}": it is not defined`)
      disabled.push({
        id: overlay.id,
        reason: overlay.reason as string,
        sources: existing.sources,
      })
      reviewers.delete(overlay.id)
      return
    }
    case 'extend': {
      if (existing === undefined) fail(`cannot extend reviewer "${overlay.id}": it is not defined`)
      reviewers.set(overlay.id, {
        policy: mergeReviewer(existing.policy, overlay.policy ?? {}),
        sources: withSource(existing.sources, 'repo-local'),
      })
      return
    }
    case 'replace': {
      if (existing === undefined) fail(`cannot replace reviewer "${overlay.id}": it is not defined`)
      reviewers.set(overlay.id, {
        policy: overlay.policy as ReviewerPolicy,
        sources: ['repo-local'],
      })
      return
    }
  }
}

/**
 * Composes the standard manifest with repository-local overlays into the
 * effective reviewer policy. Overlays are validated from `unknown` and applied
 * by stable reviewer id, so composition is deterministic and order-independent.
 * @param options Composition options.
 * @returns The effective review policy.
 */
export const composeReviewPolicy = (
  options: ComposeReviewPolicyOptions = {},
): EffectiveReviewPolicy => {
  const { basisVersion, overlays = [], standard = STANDARD_REVIEW_MANIFEST } = options

  const reviewers = new Map<ReviewerId, EffectiveReviewer>()
  standard.reviewers.forEach((raw, index) => {
    const policy = assertReviewerPolicy(raw, `standard reviewer[${index}]`)
    if (reviewers.has(policy.id)) fail(`duplicate standard reviewer id "${policy.id}"`)
    reviewers.set(policy.id, { policy, sources: ['basis-standard'] })
  })

  const disabled: DisabledReviewer[] = []
  const seen = new Set<ReviewerId>()
  for (const raw of overlays) {
    const overlay = assertReviewerOverlay(raw)
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
