---
id: tooling-conformance-churn
title: Tooling conformance churn
question: For a narrowly scoped tooling change, does the diff add churn that only exists to satisfy tooling?
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
detectors:
  - detector: diff-facts
    categories: []
evidence:
  - id: behavior
    requirement: Why each non-trivial change is or is not behavior-preserving.
  - id: diff
    requirement: The full diff, labelled with the tooling change it accompanies.
outOfScope:
  - Formatting, import, and style changes required by the adopted standard.
  - Behavior changes the tooling migration intentionally requires.
  - Changes to files the tooling change does not touch.
outcomes:
  - category: conformance-churn
    description: The diff contains semantic-looking churn unrelated to the tooling change.
    destructive: false
    outcome: finding
  - category: necessary-change
    description: The change is required by the adopted standard or is behavior-preserving.
    destructive: false
    outcome: no_finding
  - category: abstain
    description: The scope of the tooling change is unclear from the supplied evidence.
    destructive: false
    outcome: abstain
threshold:
  minimumConfidence: 0.8
  severity: info
---

For a narrowly scoped tooling or configuration migration, flag source churn that
exists only to satisfy the tooling and does not improve behavior, readability, or
policy compliance. Formatting, import order, and style changes required by the
adopted standard are not findings.
