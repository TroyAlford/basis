/**
 * Reviewer-policy types for the shared Basis review standard.
 *
 * A reviewer is a named, versionable specification — not a model and not a
 * prompt. It declares the question it answers, which deterministic detectors
 * feed it, the evidence it must gather, when it must abstain, and the structured
 * outcomes it may return. Execution (running detectors, calling models,
 * publishing reviews) belongs to the consumer; Basis owns only the policy.
 */

/** Severity rendered for a reported finding. */
export type Severity = 'error' | 'info' | 'warning'

/** How much model judgment a reviewer needs to reach a result. */
export type ExecutionProfile =
  | 'detector-then-adjudicate'
  | 'deterministic'
  | 'frontier-semantic'
  | 'local-semantic'

/** Portable outcome of a review, after any adjudication. */
export type ReviewOutcome = 'abstain' | 'finding' | 'no_finding'

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

/** A detector category that can feed a reviewer. */
export interface DetectorCategory {
  /** Category id exactly as the detector reports it (for example `nsExports`). */
  category: string,
  /** What the category means. */
  description: string,
}

/** A deterministic detector a reviewer consumes, and the categories that feed it. */
export interface DetectorRequirement {
  /** Categories that feed this reviewer; an empty list means every category. */
  categories: readonly DetectorCategory[],
  /** Detector id (for example `knip`). */
  detector: string,
}

/** Evidence a reviewer must gather before it may report a finding. */
export interface EvidenceRequirement {
  /** Stable evidence id. */
  id: string,
  /** What the evidence must demonstrate. */
  requirement: string,
}

/** One outcome a reviewer may return, and how the automation must treat it. */
export interface OutcomeDefinition {
  /** Outcome category id (for example `remove`). */
  category: string,
  /** What this outcome means and when it applies. */
  description: string,
  /** Whether remediation may delete or rewrite code without human review. */
  destructive: boolean,
  /** The portable outcome this category reports. */
  outcome: ReviewOutcome,
}

/** Confidence/severity gate applied before a finding is reported. */
export interface ReportingThreshold {
  /** Minimum confidence in the inclusive range [0, 1]. */
  minimumConfidence: number,
  /** Severity rendered for reported findings. */
  severity: Severity,
}

/** A versioned, machine-readable reviewer specification. */
export interface ReviewerPolicy {
  /** Context the reviewer needs assembled before adjudication. */
  context: readonly ContextRequirement[],
  /** Deterministic detectors that feed the reviewer. */
  detectors: readonly DetectorRequirement[],
  /** Evidence required before reporting a finding. */
  evidence: readonly EvidenceRequirement[],
  /** How much model judgment the reviewer needs. */
  executionProfile: ExecutionProfile,
  /** Stable reviewer id (for example `dead-code`). */
  id: string,
  /** Prose instructions supplied to semantic adjudication. */
  instructions: string,
  /** Explicit out-of-scope and abstention rules. */
  outOfScope: readonly string[],
  /** Outcomes the reviewer may return. */
  outcomes: readonly OutcomeDefinition[],
  /** The exact question the reviewer answers. */
  question: string,
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

/** A labelled example used to evaluate a reviewer policy. */
export interface ReviewFixture {
  /** Expected outcome category, when the fixture pins one. */
  category?: string,
  /** Why this fixture exists. */
  description: string,
  /** Unified diff text the reviewer runs against. */
  diff: string,
  /** Expected outcome for this fixture. */
  expectation: ReviewOutcome,
  /** Fixture id, unique within the manifest. */
  id: string,
  /** Reviewer the fixture exercises. */
  reviewerId: string,
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
  /** Where the reviewer came from before it was disabled. */
  source: ReviewerSource,
}

/** An effective reviewer plus where it was sourced from. */
export interface EffectiveReviewer {
  /** The effective reviewer policy. */
  policy: ReviewerPolicy,
  /** Whether the reviewer came from Basis or a repository-local overlay. */
  source: ReviewerSource,
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
