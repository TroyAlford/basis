---
id: dead-code
title: Dead code
executionProfile: detector-then-adjudicate
context:
  - changed-files
  - changed-lines
  - detector-finding
  - direct-callers
  - enclosing-scope
  - package-manifest
  - related-tests
detectors:
  - detector: knip
    categories:
      - dependencies
      - devDependencies
      - enumMembers
      - exports
      - files
      - namespaceMembers
      - nsExports
      - nsTypes
      - optionalPeerDependencies
      - types
outcomes:
  - category: remove
    disposition: finding
    destructive: true
  - category: wire-up
    disposition: finding
    destructive: false
  - category: fix-reference
    disposition: finding
    destructive: false
  - category: false-positive
    disposition: no_finding
    destructive: false
  - category: clarify-intent
    disposition: question
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.6
  severity: warning
verification:
  detector: knip
---

# Dead code

Do not ship dead code. Keep the codebase clean rather than leaving abandoned
implementations, obsolete helpers, unused exports, or dependencies behind.

Knip is evidence, not an instruction to delete. An "unused" result can mean very
different things, so inspect the purpose of this PR and enough of the surrounding
repository to decide which it is:

- **genuinely orphaned code** — an abandoned implementation or obsolete helper
  that nothing references and nothing should;
- **newly-created code that should have been wired up** — the author added a
  helper, export, or dependency but forgot to connect it;
- **preparatory work** — code added ahead of the feature that will use it, and
  that may not belong in this PR;
- **a missing reference/entrypoint/registration** — the symbol is unused only
  because a barrel, entrypoint, plugin registry, or configuration was not updated;
- **intentional dynamic or framework use** — reached by reflection, a framework
  convention, a generated entrypoint, or a test-only export.

Do not invent a definitive answer when intent is unclear. If the candidate looks
half-wired, preparatory, or otherwise ambiguous about the intended correction,
ask the author the right question rather than deleting it or abstaining.
Silently dropping an ambiguous candidate is a failure of review; deleting one
that the author intended to wire up is worse.

Report a `finding` only when the evidence shows what should change. Treat
intentional dynamic use as `no_finding`. Use `abstain` only when the available
evidence cannot support a review at all.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### Created but never wired up

```ts
// money.ts
export const parseAmount = (input: string): number | null => {
  /* ... */
}
```

Nothing imports `parseAmount`, and no consumer is being added.

Expected: `finding / wire-up`

Expected review feedback:

> `parseAmount` is exported but nothing imports it. Wire it into the code that
> needs it, or drop it from this change.

### Genuinely orphaned

```ts
// legacy-format.ts
export const formatLegacyId = (id: string): string => {
  /* ... */
}
```

Unreferenced, with nothing to suggest it is still intended.

Expected: `finding / remove`

Expected review feedback:

> This helper is unused and nothing indicates it is still needed. Remove it.

### Dynamic or framework use

```ts
// routes.ts
export const routes = [
  { component: HomePage, path: '/' },
  { component: SettingsPage, path: '/settings' },
]
```

Knip reports `routes` unused, but a framework convention references it.

Expected: `no_finding`

Expected review feedback: none.

### Preparatory work

```ts
// refund-types.ts
export interface RefundRequest {
  orderId: string
  amount: Money
}
```

Unused so far, but it looks like groundwork for an in-progress feature.

Expected: `question / clarify-intent`

Expected review feedback:

> This module is unused so far, but it looks like groundwork for an in-progress
> feature. Is it meant to be wired up in this PR, or should it wait?
