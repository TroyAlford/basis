---
id: open-closed-design
title: Open/closed design
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: repeated-variation
    disposition: finding
    destructive: false
  - category: consider-extension-point
    disposition: question
    destructive: false
  - category: local-branching
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Open/closed design

Explicit branching is acceptable while variation is small and local. Introduce
an extension mechanism when variation itself has become a repeated, reusable
architectural concept.

A `switch` over a discriminator with two cases is not a defect. One small switch
is often clearer and easier to maintain than a strategy, factory, registry, or
plugin system. Do not flag branching merely because a third or fourth variant
could hypothetically be added later; that is not evidence. Require actual
evidence, from this change or the repository, that variation has become repeated
or expensive.

That evidence looks like:

- the same discriminator is switched on in multiple locations;
- adding a variant requires editing several central branches;
- the set of variants has grown enough that the branch is difficult to reason
  about;
- case bodies share substantial structure and differ only in small
  provider-specific behavior;
- callers repeatedly need knowledge of every concrete implementation;
- the same variation is already represented in several layers;
- runtime, configuration, or product requirements make implementations
  genuinely substitutable;
- ownership or reuse pressure makes the variant itself a first-class concept.

At that point a factory, strategy, registry, polymorphism, or collection-driven
dispatch may be simpler than repeated central branching. Do not prescribe which
pattern to use. Say that variation has become architectural and ask whether the
repeated discriminator should become an extension point.

Keep this reviewer distinct from its neighbors:

- two implementations of the same concept -> `dryness`;
- whether implementations share a behavioral contract -> `substitutability`;
- whether a contract should exist -> `interface-boundaries`.

This reviewer owns whether repeated variant dispatch has become an extension
problem, not whether a pattern should be introduced for its own sake.

Use `local-branching` when explicit branching remains the simplest readable
solution, and `abstain` only when the available evidence cannot support a review
at all.

## Canonical examples

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — local branching.** A single `switch` with two payment providers
  is the only place the discriminator appears. Expected: `local-branching`.
- **No finding — hypothetical variation is not evidence.** A two-case switch is
  flagged only because a third provider "might" be added later. Expected:
  `local-branching`.
- **Question — variation is emerging.** The provider discriminator now appears in
  two places and a third provider is on the roadmap, but extraction is not yet
  clearly worthwhile. Expected: `consider-extension-point`.
- **Finding — repeated variation.** The provider discriminator is switched on in
  checkout, refunds, reporting, and webhooks; adding a provider edits all four
  central branches. Expected: `repeated-variation`.
