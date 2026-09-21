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
  - category: consider-boundary
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

Depending on a concrete implementation is the default, and for small or simple
code it is often the right answer. Introduce a contract between a caller and a
collaborator only when real pressure justifies it.

Premature abstraction and failure to abstract are opposite errors. Abstraction
should emerge from demonstrated reuse, variation, ownership, testing, or
architectural pressure.

"Every class needs an interface" is not the principle. Neither is "any class
that names an infrastructure type is wrong." A higher-level class depending
directly on one database, provider, or transport is not a finding merely because
an architectural layer could be drawn between them. Direct coupling that stays
easy to read and change is preferable to ceremony that multiplies the code
without improving comprehension.

An infrastructure seam becomes increasingly warranted as pressure appears:

- actual reuse or substitution of the collaborator;
- existing or committed multiple implementations;
- a real ownership, team, module, or package boundary;
- test isolation that cannot cheaply exercise the real collaborator;
- mechanism details materially leaking into policy and making the caller harder
  to reason about or change;
- architectural growth already visible in the repository or roadmap.

Weigh these as evidence rather than predictions. Demonstrated reuse, a committed
substitution, or a boundary that already exists is a reason now. "We might need
another implementation someday" is not; it usually produces a mirror interface
with one implementation forever.

When the signal is present but intent or roadmap determines the answer, prefer a
`question` — this is starting to look like a boundary — over manufacturing a
finding because a diagram could contain two layers.

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

An interface named after its one implementation, with no boundary it protects,
that only restates the concrete class's surface, is a finding: it adds
indirection without adding comprehension or reuse. This is the opposite error
from failing to abstract, and both are defects.

When the primary problem is that a dependency has tangled ownership or forced a
foundational unit to know application-level behavior, that finding belongs to
`dependency-direction`; remediation may still mention the seam. This reviewer
owns whether a seam should exist and what the caller-facing contract represents.

Do not punish simple coupling merely for being simple. When the concrete
dependency is appropriate, treat it as `keep-concrete`. Use `abstain` only when
the available evidence cannot support a review at all.
