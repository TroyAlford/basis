---
id: warning-baseline-regression
title: Warning baseline regression
question: Does this change increase the warning baseline, downgrade errors, or institutionalize new warnings?
executionProfile: detector-then-adjudicate
context:
  - changed-files
  - changed-lines
  - detector-finding
detectors:
  - detector: lint-baseline
    categories:
      - category: error-to-warning
        description: A lint or type error downgraded to a warning.
      - category: suppression-directive
        description: A newly added broad disable or suppression directive.
      - category: warning-count-increase
        description: A deterministic warning count that increased.
evidence:
  - id: after
    requirement: The warning and suppression state after the change.
  - id: before
    requirement: The warning and suppression state before the change.
  - id: delta
    requirement: The exact new warnings or directives this change introduced.
outOfScope:
  - Pre-existing warnings that the change neither adds nor normalizes.
  - Documentation that references an existing baseline without changing it.
outcomes:
  - category: baseline-regression
    description: The change normalizes or increases the warning baseline instead of fixing it.
    destructive: false
    outcome: finding
  - category: baseline-unchanged
    description: The change leaves the pre-existing baseline untouched.
    destructive: false
    outcome: no_finding
  - category: abstain
    description: The baseline cannot be compared from the supplied evidence.
    destructive: false
    outcome: abstain
threshold:
  minimumConfidence: 0.75
  severity: warning
verification: Re-compare the deterministic warning baseline before and after the change.
---

Separate newly introduced warnings from a pre-existing, unchanged baseline. A
finding is a change that increases the warning count, downgrades errors to
warnings, adds broad suppression directives, or documents a newly-created
baseline as intentional instead of addressing the cause.
