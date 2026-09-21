---
id: dryness
title: DRYness
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - package-manifest
  - repository-search
detectors: []
outcomes:
  - category: reuse-existing
    disposition: finding
    destructive: false
  - category: consolidate
    disposition: finding
    destructive: false
  - category: justify-duplication
    disposition: question
    destructive: false
  - category: meaningfully-distinct
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# DRYness

Do not create a second implementation of a concept the repository already knows
how to express.

Before accepting a new helper, abstraction, utility, dependency, type, service,
adapter, or implementation pattern, search the repository and its already-adopted
dependency surface for the same responsibility. Review the repository, not only
the diff.

Prefer, in order:

1. using an existing local implementation as-is;
2. extending an existing local implementation when the new behavior naturally
   belongs to the same concept;
3. using an already-adopted dependency when it already provides the required
   behavior cleanly;
4. introducing a genuinely new implementation when the responsibility is
   meaningfully different.

DRY does **not** mean forcing superficially similar code through one abstraction.
Two pieces of code may look alike while representing different concepts,
lifecycles, ownership, or reasons to change. Do not create a worse abstraction
merely to eliminate repeated syntax.

The question is semantic duplication: are there now two places that represent
the same idea or responsibility?

When an existing implementation appears to overlap substantially but intent is
unclear, ask why the new implementation should remain separate. A useful review
question identifies the existing candidate and the specific overlap; do not
simply say "this is not DRY."

Do not recommend replacing repository conventions with whatever library,
framework, or community practice happens to be fashionable. Local architecture
and established dependencies are authoritative unless the change is explicitly
about replacing them.
