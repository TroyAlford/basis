---
id: file-responsibility
title: File responsibility
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - repository-search
detectors: []
outcomes:
  - category: split-unit
    disposition: finding
    destructive: false
  - category: move-unit
    disposition: finding
    destructive: false
  - category: clarify-boundary
    disposition: question
    destructive: false
  - category: cohesive-file
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# File responsibility

Organize code around understandable units of responsibility, not arbitrary line
counts.

A file should have an obvious reason to exist. A reusable class, interface, type,
substantial function, or other independently meaningful unit should generally
have an obvious home of its own rather than being buried among unrelated units.

Do not use "the file is too long" as the review rule. A long implementation of
one coherent unit may be easier to understand than several artificially split
files. Conversely, a short file containing several unrelated exported concepts
may already have poor boundaries.

Look for changes that:

- add another independently meaningful exported unit to a file that already
  represents a different unit;
- accumulate a grab-bag of helpers, types, interfaces, classes, or constants
  whose only relationship is that they were convenient to place together;
- bury a reusable concept inside the implementation file of a different concept;
- make ownership ambiguous: a reader cannot tell which file should be opened to
  understand or change a particular responsibility.

Prefer explicit filenames that reveal what they contain.

Do not introduce nested `index.ts` barrel files as an organizational shortcut.
Barrels are acceptable only at a repository or monorepo-module root where they
define that module's public surface. Below that boundary, explicit files and
imports are easier to discover and reason about.

Do not split tightly coupled implementation details solely to satisfy this rule.
If several declarations exist only to implement one coherent unit and have no
independent meaning, keeping them together can be clearer.

When the conceptual boundary is ambiguous, ask what independently changes,
reuses, or owns the candidate unit. The answer should determine the file
boundary.

## Canonical examples

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — one cohesive unit.** A long file contains one substantial
  implementation and its private helpers. Expected: `cohesive-file`.
- **Finding — a grab bag.** A `utils` file accumulates unrelated date, string,
  and HTTP helpers with no shared concept. Expected: `split-unit`.
- **Finding — a reusable unit is buried.** A reusable `Money` type is defined
  inside the implementation file of an unrelated service. Expected: `move-unit`.
- **Question — an unclear ownership boundary.** A file contains two concepts
  whose independent ownership is unclear. Expected: `clarify-boundary`.
