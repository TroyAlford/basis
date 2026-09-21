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
  - category: relocate-responsibility
    disposition: finding
    destructive: false
  - category: invert-dependency
    disposition: finding
    destructive: false
  - category: correct-direction
    disposition: no_finding
    destructive: false
  - category: clarify-ownership
    disposition: question
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Dependency direction

High-level policy must not depend on low-level mechanism.

When a unit that expresses a rule, decision, or domain concept imports,
constructs, or reaches into a lower-level mechanism — a database or ORM, a
transport or HTTP client, the filesystem, the clock, a process, a vendor SDK, a
framework — the dependency graph points the wrong way. Changes to the mechanism
now force changes to the policy, and the mechanism's details leak into decisions
that should not know about them. This is a defect whether or not a second
implementation exists.

Direction is about which side owns the knowledge. Lower-level code may depend on
higher-level policy; the reverse is the problem.

These are correct and should be treated as `no_finding`:

- a mechanism implementing a contract defined by the policy it serves;
- low-level code depending on other low-level code;
- a composition root constructing concrete implementations and passing them
  inward.

Do not automatically prescribe an interface. Inverting the dependency can take
several forms, and the simplest correct fix is often to remove the dependency
rather than abstract it:

- move the logic to the layer that already owns the mechanism, so the policy
  works with the data it needs instead of a handle to the mechanism;
- pass the required data or a narrow value rather than the mechanism itself;
- define the capability where the policy needs it and have the mechanism depend
  on that definition.

Prefer the option that leaves the fewest layers knowing about the mechanism.
When a seam is genuinely required, whether it should exist and what the
caller-facing contract should represent belongs to `interface-boundaries`. This
reviewer owns the direction of the dependency, not the contract design.

Do not flag a lower-level type merely because it is concrete, infrastructure-
flavored, or injected. The finding is a high-level policy depending on a
lower-level mechanism, not the presence of infrastructure. When it is unclear
which layer owns a responsibility, ask which side would have to change if the
mechanism changed; ownership belongs to the side whose reasons do not include
the mechanism.

Use `abstain` only when the available evidence cannot support a review at all.
