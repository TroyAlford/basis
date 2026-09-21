---
id: interface-segregation
title: Interface segregation
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: emergent-capability
    disposition: finding
    destructive: false
  - category: forced-members
    disposition: finding
    destructive: false
  - category: consider-capability
    disposition: question
    destructive: false
  - category: coherent-interface
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Interface segregation

Split interfaces when meaningful, reusable capability boundaries emerge across
multiple implementations or concepts — not merely because individual consumers
use subsets.

A consumer that uses only `findById()` and `save()` of a larger `UserRepository`
is not evidence that the interface should be split. Even many consumers each
using a different subset is not sufficient by itself. Consumer usage describes
what callers happen to need; it does not establish a reusable capability.

A capability boundary has emerged when, for example, several repository-like
things all support `findById`/`save`/`delete`, several otherwise unrelated
things support `search`, and several support export. At that point separating
`Repository`-like CRUD, `Searchable`, and `Exportable` contracts may improve
reuse, substitution, and comprehension. If there is only one coherent
`UserRepository` and consumers merely call different subsets, splitting it into
bespoke mini-interfaces creates plumbing without useful reuse.

The question: has a reusable capability boundary emerged, or would splitting
this interface merely mirror individual consumer usage?

Pressure to split includes:

- the same subset of behavior recurring across multiple different
  implementations or concepts;
- consumers needing a capability that spans otherwise unrelated concrete types;
- implementations being forced to stub, throw, or no-op methods that do not
  belong to them;
- a coherent capability becoming independently reusable or substitutable;
- the broad interface preventing meaningful composition of capabilities.

Do not report merely because a consumer does not use every method, because the
interface has many methods, or because smaller interfaces are theoretically
possible.

Keep ownership distinct: whether a shared abstraction should exist at all
belongs to `interface-boundaries`, and whether it is behaviorally truthful
belongs to `substitutability`. This reviewer owns whether an existing contract is
sliced into useful capability boundaries.

Use `coherent-interface` when the current interface is a coherent capability,
and `abstain` only when the available evidence cannot support a review at all.
