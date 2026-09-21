---
id: dependency-direction
title: Dependency direction
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - package-manifest
  - repository-search
detectors: []
outcomes:
  - category: dependency-cycle
    disposition: finding
    destructive: false
  - category: layering-confusion
    disposition: finding
    destructive: false
  - category: consider-boundary
    disposition: question
    destructive: false
  - category: pragmatic-coupling
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Dependency direction

Keep the dependency graph understandable and generally one-directional.

A useful default mental model is that simpler, foundational units are used by
higher-order composition:

```
types / utilities  ->  classes / services  ->  applications / pages
```

Higher-order code using lower-level building blocks is normal and is not itself
a defect. The problem is tangled, surprising, or cyclical coupling — not
coupling as such.

Report a finding only when the graph is already damaged:

- **Dependency cycle.** Two or more units depend on each other, so neither can be
  understood, tested, or changed independently.
- **Layering confusion.** A dependency materially tangles ownership or forces a
  foundational, simple unit to reach upward into application-level behavior — a
  utility that imports an application service, or a core type that knows a page
  or transport's details.

Avoid inheritance diamonds: a type reachable through more than one inheritance
path makes structure and behavior order-dependent. When the real fix is a
different mechanism, that belongs to `composition-vs-inheritance`.

These are normal and should be treated as `pragmatic-coupling`:

- higher-order code depending on lower-level utilities or services;
- low-level code depending on other low-level code;
- a mechanism implementing a contract defined by the policy it serves;
- a composition root constructing concrete implementations and passing them in;
- direct coupling in small, simple software that remains easy to read and
  change.

Stronger boundaries become valuable when complexity, reuse, ownership, team size,
testing, or change coordination creates real pressure — not merely because a
package or service boundary could be drawn. A monolith or monorepo with direct
coupling is often preferable to premature package or service boundaries.
Architecture exists to improve readability and maintainability, not to satisfy a
diagram.

Do not automatically prescribe an interface, and do not assume inversion is the
fix. Depending on the condition, the correct remediation may be to move behavior,
pass data, accept the coupling, or introduce a seam. When a seam is the answer,
whether it should exist and what the caller-facing contract represents belongs to
`interface-boundaries`. This reviewer owns the shape and direction of the graph,
not the contract design.

Use `consider-boundary` as a question when scale, ownership, reuse, or testing
pressure suggests a seam may now be useful but intent or roadmap decides. Use
`abstain` only when the available evidence cannot support a review at all.

"Which side would have to change if the mechanism changed?" is one useful
diagnostic clue, not the ownership rule. Infer ownership from the domain
responsibility, the repository's existing layering, which unit is foundational
versus higher-order, current ownership and module boundaries, whether one side is
made to know details it should not need, and the current scale and complexity. Do
not turn one heuristic into a theorem.

## Canonical examples

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — higher-order uses foundational.** A page composes a service, and
  the service uses utilities and shared types. The flow is one-directional.
  Expected: `pragmatic-coupling`.
- **Finding — a cycle.** `OrderService` imports `InvoiceService` and
  `InvoiceService` imports `OrderService`, so neither can be understood or tested
  alone. Expected: `dependency-cycle`.
- **Finding — a foundational unit reaches upward.** A low-level formatting
  utility imports an application service to send a notification when it
  encounters bad input. Expected: `layering-confusion`.
- **Question — boundary pressure is growing.** A shared module is accumulating
  both storage and UI knowledge as the application grows, and intent is unclear.
  Expected: `consider-boundary`.
