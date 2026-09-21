---
id: substitutability
title: Substitutability
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: contract-violation
    disposition: finding
    destructive: false
  - category: implementation-specific-knowledge
    disposition: finding
    destructive: false
  - category: clarify-shared-contract
    disposition: question
    destructive: false
  - category: valid-substitute
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Substitutability

Substitutability is behavioral, not structural. Matching TypeScript method
signatures is insufficient. A caller must be able to use an implementation
through the shared contract without implementation-specific knowledge.

The central question: can a caller rely on this abstraction without knowing
which concrete implementation it received?

Implementations must honor the behavior the contract promises, not merely its
shape. Signals of a real violation:

- an implementation requires stronger preconditions than the shared contract
  communicates;
- an implementation weakens a guarantee callers reasonably rely on;
- an implementation throws or fails for a valid contract operation where failure
  is not part of the contract;
- an implementation returns materially different semantics behind the same
  nominal result;
- callers need `instanceof`, implementation-name checks, casts, or other
  concrete-type knowledge to use the abstraction correctly;
- an override deliberately disables behavior the parent or base contract
  promises;
- a factory returns a shared type while callers immediately branch on which
  concrete thing they received.

Failure is not itself the defect. Throwing is valid when failure is part of the
declared behavioral contract and every caller is expected to handle it. The
defect is disagreement between the abstraction's promised behavior and an
implementation's actual behavior.

Preserve the anti-abstraction side as well. Shared shape is not shared identity:
two unrelated concepts both having an `invoke()` method does not mean an
`Invokable` abstraction should exist. Matching one or several method signatures
becomes interesting only when treating the things through one shared behavioral
contract actually simplifies reuse, testing, or maintenance. Substantial overlap
without interchangeability is a question signal, not proof that an abstraction
should be extracted. If the abstraction would make the system more complicated
rather than simpler, do not introduce it.

Keep ownership distinct:

- whether a seam or interface should exist -> `interface-boundaries`;
- whether an existing shared abstraction is behaviorally truthful -> this
  reviewer;
- whether an interface is sliced into useful capability boundaries ->
  `interface-segregation`;
- whether inheritance is the right reuse mechanism ->
  `composition-vs-inheritance`.

Use `valid-substitute` when an implementation honors the contract, and `abstain`
only when the available evidence cannot support a review at all.
