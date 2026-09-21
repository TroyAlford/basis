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

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### A dependency cycle

```ts
// order-service.ts
import { InvoiceService } from './invoice-service'

// invoice-service.ts
import { OrderService } from './order-service'
```

The two services depend on each other.

Expected: `finding / dependency-cycle`

Expected review feedback:

> `OrderService` and `InvoiceService` import each other, so neither can be
> understood, tested, or changed alone. Break the cycle: one of them should not
> need to know about the other.

### A foundational unit reaching upward

```ts
// format-amount.ts
import { notifyAdmin } from '../services/notifications'

export const formatAmount = (amount: number): string => {
  if (amount < 0) notifyAdmin('negative amount')
  return amount.toFixed(2)
}
```

A low-level formatting utility imports an application service.

Expected: `finding / layering-confusion`

Expected review feedback:

> A formatting utility is importing an application service to send
> notifications. Foundational helpers should not reach upward into application
> behavior; move that decision to the layer that owns it.

### One-directional composition

```ts
// checkout-page.ts
import { CheckoutService } from '../services/checkout'
import { formatMoney } from '../utilities/money'

export const renderCheckout = (cart: Cart): string =>
  `${formatMoney(cart.total)} — ${CheckoutService.describe(cart)}`
```

Higher-order code uses lower-level building blocks, one direction only.

Expected: `no_finding`

Expected review feedback: none.
