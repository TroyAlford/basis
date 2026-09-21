/**
 * Reviewer-policy types for the shared Basis review standard.
 *
 * A reviewer is a named, versionable specification — not a model and not a
 * prompt. Its canonical form is a Markdown document: mechanical metadata in the
 * YAML front-matter and the engineering principle, reasoning, and instructions
 * in the body. These types are the derived runtime representation the executor
 * consumes.
 */

/** Severity rendered for a reported finding. */
export type Severity = 'error' | 'info' | 'warning'

/** How much model judgment a reviewer needs to reach a result. */
export type ExecutionProfile =
  | 'detector-then-adjudicate'
  | 'deterministic'
  | 'frontier-semantic'
  | 'local-semantic'

/**
 * Portable disposition of a review.
 *
 * - `finding` — sufficient evidence that something should change;
 * - `question` — the author must resolve an ambiguity or explain intent;
 * - `no_finding` — the candidate is adequately explained or acceptable;
 * - `abstain` — the reviewer cannot perform the review from the available evidence.
 */
export type ReviewDisposition = 'abstain' | 'finding' | 'no_finding' | 'question'

/** Data a reviewer needs assembled before it can adjudicate. */
export type ContextRequirement =
  | 'changed-files'
  | 'changed-lines'
  | 'detector-finding'
  | 'direct-callers'
  | 'enclosing-scope'
  | 'package-manifest'
  | 'related-tests'
  | 'schemas'

/** Where an effective reviewer came from. */
export type ReviewerSource = 'basis-standard' | 'repo-local'

/** How a repository-local overlay combines with the standard policy. */
export type OverlayMode = 'add' | 'disable' | 'extend' | 'replace'

/** A deterministic detector and the category selectors that feed a reviewer. */
export interface DetectorRequirement {
  /** Detector category selectors; an empty list means every category. */
  categories: readonly string[],
  /** Detector id (for example `knip`). */
  detector: string,
}

/** One disposition a reviewer may return. */
export interface OutcomeDefinition {
  /** Outcome category id (for example `remove`). */
  category: string,
  /** Whether remediation may delete or rewrite code without human review. */
  destructive: boolean,
  /** Portable disposition this category maps to. */
  disposition: ReviewDisposition,
}

/** Confidence/severity gate applied before a finding is reported. */
export interface ReportingThreshold {
  /** Minimum confidence in the inclusive range [0, 1]. */
  minimumConfidence: number,
  /** Severity rendered for reported findings. */
  severity: Severity,
}

/** The derived runtime representation of a reviewer. */
export interface ReviewerPolicy {
  /** Context the reviewer needs assembled before adjudication. */
  context: readonly ContextRequirement[],
  /** Deterministic detectors that feed the reviewer. */
  detectors: readonly DetectorRequirement[],
  /** How much model judgment the reviewer needs. */
  executionProfile: ExecutionProfile,
  /** Stable reviewer id, taken from the front-matter. */
  id: string,
  /** Adjudication instructions, authored as the Markdown body. */
  instructions: string,
  /** Dispositions the reviewer may return. */
  outcomes: readonly OutcomeDefinition[],
  /** Reporting threshold. */
  threshold: ReportingThreshold,
  /** Short human-readable title. */
  title: string,
  /** Deterministic check that proves a repair, when one exists. */
  verification?: string,
}

/** A versioned set of reviewer policies. */
export interface ReviewManifest {
  /** Manifest id (for example `basis-standard`). */
  id: string,
  /** Reviewers contained in the manifest. */
  reviewers: readonly ReviewerPolicy[],
  /** Schema version of the policy format. */
  schemaVersion: number,
}

/** A repository-local reviewer overlay, keyed by stable reviewer id. */
export interface ReviewerOverlay {
  /** Reviewer id this overlay targets. */
  id: string,
  /** Composition mode. */
  mode: OverlayMode,
  /** Overlay payload: full for `add`/`replace`, partial for `extend`. */
  policy?: Partial<ReviewerPolicy>,
  /** Why the reviewer is disabled; required for `disable`. */
  reason?: string,
}

/** A reviewer disabled by a repository-local overlay. */
export interface DisabledReviewer {
  /** Disabled reviewer id. */
  id: string,
  /** Why it was disabled. */
  reason: string,
  /** Every source that shaped the reviewer before it was disabled. */
  sources: readonly ReviewerSource[],
}

/** An effective reviewer plus the sources that shaped it. */
export interface EffectiveReviewer {
  /** The effective reviewer policy. */
  policy: ReviewerPolicy,
  /** Every source that shaped the reviewer, Basis first. */
  sources: readonly ReviewerSource[],
}

/** The effective policy produced by composing a standard manifest with overlays. */
export interface EffectiveReviewPolicy {
  /** Basis release version recorded for provenance, when known. */
  basisVersion?: string,
  /** Reviewers disabled by an overlay, with reasons. */
  disabled: readonly DisabledReviewer[],
  /** Manifest id the policy was composed from. */
  id: string,
  /** Effective, enabled reviewers. */
  reviewers: readonly EffectiveReviewer[],
  /** Schema version of the composed policy. */
  schemaVersion: number,
}

/** A labelled example used to evaluate a reviewer policy. */
export interface ReviewFixture {
  /** Expected outcome category, when the fixture pins one. */
  category?: string,
  /** Why this fixture exists. */
  description: string,
  /** Unified diff text the reviewer runs against. */
  diff: string,
  /** Expected disposition for this fixture. */
  expectation: ReviewDisposition,
  /** Fixture id, unique within the manifest. */
  id: string,
  /** Reviewer the fixture exercises. */
  reviewerId: string,
}
