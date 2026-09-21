---
id: open-closed-design
title: Open/closed design
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: repeated-variation
    disposition: finding
    destructive: false
  - category: consider-extension-point
    disposition: question
    destructive: false
  - category: local-branching
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Open/closed design

Explicit branching is acceptable while variation is small and local. Introduce
an extension mechanism when variation itself has become a repeated, reusable
architectural concept.

A `switch` over a discriminator with two cases is not a defect. One small switch
is often clearer and easier to maintain than a strategy, factory, registry, or
plugin system. Do not flag branching merely because a third or fourth variant
could hypothetically be added later; that is not evidence. Require actual
evidence, from this change or the repository, that variation has become repeated
or expensive.

That evidence looks like:

- the same discriminator is switched on in multiple locations;
- adding a variant requires editing several central branches;
- the set of variants has grown enough that the branch is difficult to reason
  about;
- case bodies share substantial structure and differ only in small
  provider-specific behavior;
- callers repeatedly need knowledge of every concrete implementation;
- the same variation is already represented in several layers;
- runtime, configuration, or product requirements make implementations
  genuinely substitutable;
- ownership or reuse pressure makes the variant itself a first-class concept.

At that point a factory, strategy, registry, polymorphism, or collection-driven
dispatch may be simpler than repeated central branching. Do not prescribe which
pattern to use. Say that variation has become architectural and ask whether the
repeated discriminator should become an extension point.

Keep this reviewer distinct from its neighbors:

- two implementations of the same concept -> `dryness`;
- whether implementations share a behavioral contract -> `substitutability`;
- whether a contract should exist -> `interface-boundaries`.

This reviewer owns whether repeated variant dispatch has become an extension
problem, not whether a pattern should be introduced for its own sake.

Use `local-branching` when explicit branching remains the simplest readable
solution, and `abstain` only when the available evidence cannot support a review
at all.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### Repeated variation across central branches

```ts
// checkout.ts
switch (provider) {
  case 'stripe': return chargeStripe(cart)
  case 'paypal': return chargePayPal(cart)
}

// refunds.ts
switch (provider) {
  case 'stripe': return refundStripe(order)
  case 'paypal': return refundPayPal(order)
}

// webhooks.ts
switch (provider) {
  case 'stripe': return handleStripeWebhook(body)
  case 'paypal': return handlePayPalWebhook(body)
}
```

The same discriminator is switched on in several places.

Expected: `finding / repeated-variation`

Expected review feedback:

> The same provider discriminator is switched on in checkout, refunds, and
> webhooks, so adding a provider means editing all three. Variation is now
> architectural: introduce one extension point that dispatch goes through.

### Local branching

```ts
const label = provider === 'stripe' ? 'Card' : 'PayPal'
```

A single local branch; variation is not repeated.

Expected: `no_finding`

Expected review feedback: none.

### Variation that is emerging, not yet settled

```ts
// checkout.ts
if (provider === 'stripe') { /* ... */ } else if (provider === 'paypal') { /* ... */ }

// settings.ts
if (provider === 'stripe') { /* ... */ } else if (provider === 'paypal') { /* ... */ }
```

The discriminator now appears twice and a third provider is planned, but the
shape of an extension point is not yet clear.

Expected: `question / consider-extension-point`

Expected review feedback:

> The provider discriminator now appears in two places and a third provider is
> planned. Is variation becoming a reusable concept here? If so, one extension
> point may be simpler than editing each branch as providers grow.
