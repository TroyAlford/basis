---
id: composition-vs-inheritance
title: Composition vs inheritance
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: misused-inheritance
    disposition: finding
    destructive: false
  - category: variable-capability
    disposition: finding
    destructive: false
  - category: consider-shared-base
    disposition: question
    destructive: false
  - category: appropriate-inheritance
    disposition: no_finding
    destructive: false
  - category: appropriate-composition
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Composition vs inheritance

Choose the mechanism that matches the relationship, not a slogan.

- Use a base class when there is shared default behavior that subclasses should
  inherit.
- Use an interface when there is a common required shape but no shared default
  implementation.
- Use composition or dependency injection when the behavior itself must vary
  independently of the containing object's identity.

A `RetryingService` base class with a protected `withRetry` helper is reasonable
when retry behavior is the same shared default everywhere. A `RetryPolicy`
injected into services becomes more attractive when the retry behavior itself
must vary: test versus production, service-specific strategies, runtime or
configuration selection, multiple policies chosen by a factory or container, or
independent lifecycle, state, or ownership. Composition earns its complexity
when the composed capability needs independent substitution. If the behavior is
universal and stable, a base-class default can be simpler.

Preserve these:

- inheritance makes sense when multiple concrete implementations genuinely share
  behavior and satisfy the same behavioral contract;
- interfaces make sense when multiple implementations need the same shape but
  not shared implementation;
- composition suits orthogonal behavior that varies independently;
- shared implementation is evidence for a base class, but do not create an
  inheritance hierarchy speculatively before reuse or variation has actually
  emerged;
- inheritance used only to borrow a convenient helper from an otherwise
  unrelated type is suspect;
- inheritance diamonds should be avoided;
- divergent use cases expressed as flags or optional behavior on one class may
  indicate a missing abstraction.

The central question: is this relationship shared identity and default behavior,
or an independently variable capability?

Both inheritance and composition can be correct. When multiple designs are
reasonable, ask about intent rather than asserting a universal answer. Do not
reward dependency-injection plumbing merely for existing: if every environment
and implementation uses the same retry policy, injecting `RetryPolicy` can be
more machinery than a shared default implementation.

Keep ownership distinct: whether implementations share a behavioral contract
belongs to `substitutability`, and whether repeated variation has become an
extension problem belongs to `open-closed-design`. This reviewer owns whether
inheritance or composition is the right mechanism for the relationship.

Use `appropriate-inheritance` or `appropriate-composition` when the chosen
mechanism matches the relationship, and `abstain` only when the available
evidence cannot support a review at all.

## Canonical examples

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — shared default behavior.** Several services extend a base class
  that provides identical retry behavior, inherited unchanged. Expected:
  `appropriate-inheritance`.
- **No finding — independently variable capability.** A service receives a
  configurable retry policy because tests and production need different
  strategies. Expected: `appropriate-composition`.
- **Finding — borrowing a helper across unrelated types.** A `UserService`
  extends `HttpClient` only to reuse a request helper; the two share no identity.
  Expected: `misused-inheritance`.
- **Finding — a variable capability is hard-wired.** Retry behavior lives in a
  base class, each service overrides it differently, and environments select
  strategies at runtime. Expected: `variable-capability`.
