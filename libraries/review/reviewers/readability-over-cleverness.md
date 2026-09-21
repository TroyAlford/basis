---
id: readability-over-cleverness
title: Readability over cleverness
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - related-tests
detectors: []
outcomes:
  - category: simplify
    disposition: finding
    destructive: false
  - category: clarify-naming
    disposition: finding
    destructive: false
  - category: explain-necessary-complexity
    disposition: question
    destructive: false
  - category: clear
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Readability over cleverness

After correctness, software should be easy for a future reader to understand and
maintain.

Prefer code that says what it means directly. Do not compress straightforward
logic into clever expressions merely because they are shorter. Brevity is useful
only when it also improves clarity.

Names should carry meaning. Avoid abbreviations, acronyms, single-letter names,
or shortened forms when they make the reader translate the code mentally.
Common language and domain terms are acceptable when their meaning is genuinely
unambiguous in context; convenience abbreviations such as `def` for
`default` or `opts` for `options` are not.

Code should usually be self-documenting through structure, names, types, and
small cohesive operations. Comments and JSDoc should explain information the
code itself cannot communicate clearly: intent, constraints, non-obvious
behavior, external contracts, or necessary implementation tradeoffs.

Do not use comments as camouflage for avoidable complexity. If ordinary control
flow and descriptive names can make an implementation obvious, prefer that over
a dense implementation followed by a paragraph explaining it.

Necessary complexity is different. Performance-sensitive code, bitwise
operations, unusual protocol logic, carefully chosen ternaries, or other
non-obvious implementations may be entirely appropriate. In those cases,
preserve the implementation when its reason is real and make the reason clear.

Review the complexity relative to the problem being solved. The question is not
"could this be written differently?" It is "has this change made the code harder
to understand than the underlying problem requires?"

Do not recommend a fashionable idiom merely because it is more common in the
wider ecosystem. Readability is judged in the context of this codebase and its
established design conventions.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### Compressed beyond clarity

```ts
const totals = orders.reduce(
  (a, o) => ({ ...a, [o.id]: (a[o.id] ?? 0) + o.total }),
  {} as Record<string, number>,
)
```

Expected: `finding / simplify`

Expected review feedback:

> This packs several operations into one expression. A simple loop with
> descriptive names would be easier to follow and just as correct.

### Names that require translation

```ts
function calc(d: Document, opts: CalcOpts): number {
  const r = d.rows.filter(x => x.v > 0)
  return r.reduce((s, x) => s + x.v, 0)
}
```

Expected: `finding / clarify-naming`

Expected review feedback:

> Names like `d`, `opts`, `r`, `x`, `s`, and `v` make the reader decode every
> line. Use descriptive names such as `document`, `options`, `rows`, `row`,
> `sum`, and `value`.

### Direct and clear

```ts
function totalPositive(values: number[]): number {
  let sum = 0
  for (const value of values) {
    if (value > 0) sum += value
  }
  return sum
}
```

Expected: `no_finding`

Expected review feedback: none.

### Necessary complexity without explanation

```ts
const hash = (value: number): number => (value ^ (value >>> 16)) * 0x45d9f3b
```

Non-obvious, but it may be deliberate.

Expected: `question / explain-necessary-complexity`

Expected review feedback:

> This bitwise hash is not obvious. If its form is required (for example, for
> distribution or performance), add a comment explaining why so the next reader
> does not simplify it away. Otherwise, prefer something clearer.
