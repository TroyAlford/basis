---
id: single-responsibility
title: Single responsibility
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - repository-search
detectors: []
outcomes:
  - category: incoherent-unit
    disposition: finding
    destructive: false
  - category: forced-variation
    disposition: finding
    destructive: false
  - category: consider-extraction
    disposition: question
    destructive: false
  - category: coherent-unit
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Single responsibility

Group behavior around a coherent identity or domain responsibility. Decompose
when doing so improves reuse, testability, readability, or maintainability — not
because smaller units are inherently better.

This is deliberately not the common "one class, one method" or "one tiny reason
to change" reading. A `UserService` may reasonably own creating a user, sending
the welcome email, updating a profile, and resetting a password when those are
coherently the actions of the user service. Do not flag it merely because
persistence, email, auth, and profile could each be described as separate
concerns. Naming several concerns is not the same as having several
responsibilities.

The question is whether the unit still coheres around the identity or
responsibility it represents. Classes may legitimately represent identity,
state, behavior, and change over time; functional decomposition is not
inherently superior.

Pressure to extract appears when:

- behavior becomes genuinely reusable across multiple identities or
  implementations;
- a generic capability emerges outside the current domain object;
- distinct use cases force flags, optional properties, or special-case methods
  into one identity;
- extraction would create a clearly better, independently understandable and
  testable unit;
- the unit accumulates machinery that no longer coheres around the identity or
  responsibility it represents.

Decomposition is a tool for comprehension and reuse, not an objective in itself.
Do not recommend splitting a straightforward implementation into many units
unless the result is easier to reason about, reuse, or test. Turning a coherent
500-line unit into 2,500 lines of abstractions makes the code worse, not better.

Keep this reviewer distinct from physical placement (`file-responsibility`) and
semantic duplication or reuse (`dryness`). When behavior looks independently
reusable but intent is unclear, prefer a `question` over asserting an
extraction.

The highest-order rubric is unchanged: software must work and meet its
specification; after that it should be readable and maintainable.

## Canonical examples

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — a coherent identity.** A `UserService` owns create, welcome
  email, profile update, and password reset; callers use it as one concept.
  Expected: `coherent-unit`.
- **Finding — divergent use cases force variation.** The same `ReportService`
  threads `format: 'html' | 'csv' | 'pdf'` through every method, and each format
  follows different rules. Expected: `forced-variation`.
- **Finding — machinery no longer coheres.** A `UserService` also owns an
  unrelated background scheduler and a cache-invalidation protocol with no shared
  identity. Expected: `incoherent-unit`.
- **Question — a reusable capability appears.** A `UserService` contains a
  generic retry routine that an unrelated service now wants; intent is unclear.
  Expected: `consider-extraction`.
