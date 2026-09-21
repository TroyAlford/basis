---
id: interface-boundaries
title: Interface boundaries
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: introduce-contract
    disposition: finding
    destructive: false
  - category: remove-speculative-abstraction
    disposition: finding
    destructive: false
  - category: clarify-intent
    disposition: question
    destructive: false
  - category: keep-concrete
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Interface boundaries

Depending on a concrete implementation is the default. Introduce a contract
between a caller and a collaborator only when there is a real reason the caller
should not depend on that concrete implementation.

"Every class needs an interface" is not the principle. An interface named after
a class, sitting beside that class, with one implementation and no boundary it
protects, is speculative abstraction rather than design.

Keep the concrete type when the collaborator is a value, a helper, or an
in-memory dependency that callers can construct and exercise directly; when
there is one implementation and no layer or process boundary that a contract
would protect; or when the concrete type itself is the concept the caller needs.
A class that is part of the mechanism — a storage adapter, a driver wrapper —
may legitimately depend on its concrete mechanism. The problem is not
concreteness; it is policy depending on mechanism.

Introduce a contract when at least one of these is true:

- **Architectural boundary.** A higher-level policy is coupled to a lower-level
  mechanism — storage, transport, the clock, the filesystem, a process, a
  third-party SDK. The mechanism's details leak upward even when only one
  implementation exists.
- **Genuine substitution.** More than one implementation exists, or a committed
  requirement calls for one, including product variants such as pluggable
  backends, environment-specific implementations, or an implementation supplied
  by another package.
- **Boundary test substitution.** The real collaborator crosses a system or
  process boundary and cannot be exercised cheaply, deterministically, or
  offline. Testability is a consequence of a real boundary, not an independent
  reason to abstract an in-memory object that tests could construct directly.
- **Published or cross-module contract.** The contract is consumed across a
  module or package boundary, so callers must be able to depend on a stable
  capability rather than a particular implementation.

Weigh these by how much they are facts about this change rather than
predictions. A real architectural boundary or a committed substitution is a
reason now. "We might need another implementation someday" is not; it is a bet
that usually produces a mirror interface with one implementation forever.

Shape a new contract to the consumer, not the implementation. Depending on
`PostgresDatabase` is often wrong, but so is depending on a generic `Database`
that mirrors every capability the concrete class exposes. The useful contract is
the narrow, domain-shaped capability the caller actually uses — for example a
`ReportStore` with the find/save operations the caller needs — owned by the
layer that requires it. A contract that copies the concrete class's public
surface one method at a time is a leak with extra steps. Narrowing a contract
that is being introduced belongs here; an existing contract that forces
consumers to depend on members they do not use belongs to
`interface-segregation`.

When the primary defect is that the dependency graph points the wrong way — a
domain importing infrastructure, a core importing an adapter — that finding
belongs to `dependency-direction`; remediation may still mention the seam. This
reviewer owns whether a seam should exist here and what the caller-facing
contract should represent.

Do not report a finding merely because a concrete type is injected. When the
concrete dependency is appropriate, treat it as `no_finding`. When a new
contract has a single implementation and no obvious boundary, ask whether
another implementation or an architectural boundary is expected before assuming
either correction. Use `abstain` only when the available evidence cannot
support a review at all.
