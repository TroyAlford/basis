# `@basis/review`

Shared, **versioned** code-review policy for the first-party ecosystem.

Basis owns the durable opinion — stable reviewer ids, their questions, evidence
and abstention rules, structured outcomes, and reporting thresholds.
Consumers own execution: running detectors, calling models, repairing code, and
publishing reviews. A reviewer is a specification, not a model and not a prompt.

The surface is exposed to consumers as `basis/review`.

## Standard reviewers

| Reviewer id | Profile | Purpose |
| --- | --- | --- |
| `placeholder-documentation` | detector + adjudication | Documentation added only to satisfy a rule. |
| `warning-baseline-regression` | detector + adjudication | A newly normalized or increased warning baseline. |
| `tooling-conformance-churn` | local semantic | Source churn that only satisfies tooling. |
| `dead-code` | detector + adjudication | Diff-scoped unused files/exports/dependencies. |

Each reviewer declares:

- `id`, `title`, and the exact `question` it answers;
- `executionProfile` (how much model judgment it needs);
- `detectors` and the detector `categories` that feed it;
- `evidence` required before it may report a finding;
- `outOfScope` and abstention rules;
- `context` it needs assembled;
- `outcomes`, each of which is `finding`, `no_finding`, or `abstain`, and each
  of which marks whether remediation is `destructive`;
- `threshold` (minimum confidence and default severity);
- optional `verification` — the deterministic check that proves a repair.

`deterministic`, `detector-then-adjudicate`, `local-semantic`, and
`frontier-semantic` are the supported profiles. A reviewer never makes a
destructive change on a detector finding alone.

### Dead code

`dead-code` consumes knip categories that are genuinely dead-code semantics
(`files`, `exports`, `types`, `nsExports`, `nsTypes`, `enumMembers`,
`namespaceMembers`, `dependencies`, `devDependencies`,
`optionalPeerDependencies`). Other knip categories — `unresolved`, `unlisted`,
`cycles`, `duplicates` — are **not** dead-code semantics; the detector still
normalizes them, but the policy routes them elsewhere. Category names are used
exactly as knip reports them.

## Repository-local overlays

A repository addresses standard reviewers by stable id through the conventional
overlay directory:

```
.basis/reviewers/
```

Each overlay is `add`, `extend`, `replace`, or `disable`. Composition is keyed by
reviewer id and never depends on filename or overlay order. Duplicate overlays
for the same id are rejected.

```ts
import { composeReviewPolicy } from 'basis/review'

const effective = composeReviewPolicy({
  basisVersion: 'v3.26.0',
  overlays: [
    {
      id: 'dead-code',
      mode: 'extend',
      policy: {
        outOfScope: ['Generated migration modules under src/migrations/.'],
      },
    },
    {
      id: 'tooling-conformance-churn',
      mode: 'disable',
      reason: 'This repository has no tooling migrations.',
    },
  ],
})
```

`extend` replaces scalar fields and appends array fields. `replace` requires a
full reviewer. `disable` requires a reason and records the reviewer in
`disabled`. Composition is fail-closed: overlays are validated from `unknown`
before they are applied, so malformed repository policy is rejected rather than
executed. Every effective reviewer carries `sources` (`basis-standard` and/or
`repo-local`) so review output can show where a policy came from — an extended
reviewer reports both.

## Fixtures

`STANDARD_REVIEW_FIXTURES` holds labelled positive/negative diffs for the
standard reviewers. A consumer's evaluator runs each reviewer against a fixture
and compares the adjudicated outcome. Basis ships **no** model runtime and does
**not** publish reviews.
