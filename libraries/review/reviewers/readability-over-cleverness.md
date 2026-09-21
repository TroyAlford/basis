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

These examples are part of this reviewer's specification and instructions. They
calibrate the intended judgment boundary and are not exhaustive.

- **No finding — direct and clear.** A straightforward loop with descriptive
  names. Expected: `clear`.
- **Finding — compressed beyond clarity.** A dense `reduce` with single-letter
  names computes a value a simple loop would express directly. Expected:
  `simplify`.
- **Finding — names that require translation.** Parameters named `d` for
  `document` and `opts` for `options`. Expected: `clarify-naming`.
- **Question — necessary but unexplained complexity.** A carefully chosen bitwise
  operation is non-obvious but performance-critical, and the reason is
  undocumented. Expected: `explain-necessary-complexity`.
