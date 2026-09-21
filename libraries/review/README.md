# `@basis/review`

Shared, **versioned** code-review policy for the first-party ecosystem.

The model is a strict separation of layers:

```
reviewer Markdown                 canonical policy and documentation
Basis parser/validator            safety and type boundary
typed TS objects                  derived runtime representation
ai-dispatcher                     execution
```

Basis owns the durable opinion. Consumers own execution: running detectors,
calling models, repairing code, and publishing reviews. Adding a reviewer is
adding one Markdown document, not editing a TypeScript registry.

The surface is exposed to consumers as `basis/review`.

## Authoring a reviewer

Standard reviewers live in `libraries/review/reviewers/` as Markdown documents.
The YAML front-matter carries **only mechanical metadata the runtime needs**;
the body carries the engineering principle, reasoning, exceptions, and
instructions. `parseReviewerSource` parses one document and
`loadReviewerDirectory` loads a directory; both fail closed.

Front-matter fields:

| Field | Meaning |
| --- | --- |
| `id` | stable reviewer id (addressable by overlays) |
| `title` | short human-readable title |
| `executionProfile` | `deterministic`, `detector-then-adjudicate`, `local-semantic`, or `frontier-semantic` |
| `detectors` | `[{ detector, categories }]` selectors that feed the reviewer |
| `context` | context the runtime must assemble before adjudication |
| `outcomes` | `[{ category, disposition, destructive }]` the reviewer may return |
| `threshold` | `{ minimumConfidence, severity }` reporting gate |
| `verification` | optional registered check that proves a repair: `{ detector }` |

A `disposition` is one of `finding`, `question`, `no_finding`, or `abstain`:

- `finding` — enough evidence that something should change;
- `question` — the author must resolve an ambiguity or explain intent;
- `no_finding` — the candidate is adequately explained or acceptable;
- `abstain` — the reviewer cannot perform the review from the available evidence.

````md
---
id: example
title: Example
executionProfile: detector-then-adjudicate
context:
  - changed-lines
detectors:
  - detector: knip
    categories:
      - exports
outcomes:
  - category: remove
    disposition: finding
    destructive: true
  - category: clarify-intent
    disposition: question
    destructive: false
threshold:
  minimumConfidence: 0.6
  severity: warning
verification:
  detector: knip
---

# Example

The engineering principle, what the detector result means, when to report a
finding, when to ask the author a question, and when to abstain.
````

`instructions` must live in the body; supplying it in the front-matter is
rejected. Invalid YAML, a missing or unterminated block, unknown keys, an empty
body, and malformed nested values all fail closed with a `[basis/review]` error.

## Repository-local overlays

A repository extends the standard policy through the conventional overlay
directory, authored with the same Markdown + front-matter model:

```
.basis/reviewers/
```

An overlay's front-matter declares `id` and `mode` (`add`, `extend`, `replace`,
or `disable`); its body is contributed `instructions`. For `extend`, front-matter
scalars replace and arrays append, and the body is **appended** to the standard
instructions. A `disable` overlay carries its `reason` in the front-matter and
may carry neither policy fields nor a body: authored policy is never silently
discarded.

````md
---
id: example
mode: extend
---

Repository-specific guidance appended to the standard example policy.
````

```ts
import { composeReviewPolicy, loadOverlayDirectory } from 'basis/review'

const effective = composeReviewPolicy({
  basisVersion: 'v3.26.0',
  overlays: loadOverlayDirectory('.basis/reviewers'),
})
```

Composition is keyed by stable reviewer id — never filename or overlay order —
and is fail-closed: documents and objects are parsed from `unknown` and validated
before they are applied. Every effective reviewer carries `sources`
(`basis-standard` and/or `repo-local`); an extended reviewer reports both.

## Scope

Basis owns policy only: it ships no evaluation corpus, model runtime, or review
publication. Evaluation-corpus modeling belongs to the consumer (`ai-dispatcher`).
