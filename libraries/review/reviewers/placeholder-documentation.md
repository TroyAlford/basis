---
id: placeholder-documentation
title: Placeholder documentation
question: Does this change add documentation that has no descriptive prose of its own?
executionProfile: detector-then-adjudicate
context:
  - changed-lines
  - enclosing-scope
detectors:
  - detector: docblock-prose
    categories:
      - category: empty-block
        description: A documentation or comment block added with no descriptive prose.
      - category: tags-only-block
        description: A block containing only tags such as @param with no description text.
evidence:
  - id: block
    requirement: The exact added block and the symbol it documents.
  - id: hunk
    requirement: The diff hunk showing the block did not exist before this change.
outOfScope:
  - Pre-existing blocks that this change did not touch.
  - Generated files and test fixtures.
  - Blocks whose prose is meaningful even if terse.
outcomes:
  - category: placeholder-added
    description: The block is scaffolding added only to satisfy a documentation rule.
    destructive: false
    outcome: finding
  - category: documented
    description: The block states something a reader did not already know from the identifier.
    destructive: false
    outcome: no_finding
  - category: abstain
    description: Intent cannot be established safely from the supplied evidence.
    destructive: false
    outcome: abstain
threshold:
  minimumConfidence: 0.7
  severity: info
verification: Re-run the docblock-prose scan over the changed range.
---

Flag only blocks this change added that carry no descriptive prose of their own.
Tags alone do not make documentation: a lone `@param` with no description, or an
empty block, is scaffolding. Do not flag a block that tells the reader something
non-obvious, even if it is terse.
