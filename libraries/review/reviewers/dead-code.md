---
id: dead-code
title: Dead code
question: Why is this code unused, and what is the intended correction?
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
      - category: dependencies
        description: Runtime dependency declared but never imported.
      - category: devDependencies
        description: Dev dependency declared but never used.
      - category: enumMembers
        description: Enum member that is never referenced.
      - category: exports
        description: Module export that is never imported.
      - category: files
        description: Source file that is never imported.
      - category: namespaceMembers
        description: Namespace member that is never referenced.
      - category: nsExports
        description: Export reachable only through a namespace that is unused.
      - category: nsTypes
        description: Type export reachable only through a namespace that is unused.
      - category: optionalPeerDependencies
        description: Optional peer dependency declared but never used.
      - category: types
        description: Type export that is never imported.
evidence:
  - id: finding
    requirement: The detector finding and the changed file or symbol it is attributed to.
  - id: usage
    requirement: Evidence of dynamic, reflective, framework, or entrypoint use, when any.
outOfScope:
  - Dynamic or reflective use that a static analyzer cannot see.
  - Framework entrypoints and convention files.
  - Generated code and test-only exports.
  - Public package entrypoints whose removal would change the public API.
outcomes:
  - category: remove
    description: Genuinely dead code that should be removed.
    destructive: true
    outcome: finding
  - category: wire-up
    description: Code that should have been used and needs connecting.
    destructive: false
    outcome: finding
  - category: fix-reference
    description: A missing entrypoint, configuration, or export reference.
    destructive: false
    outcome: finding
  - category: false-positive
    description: Intentional dynamic, framework, or convention use; not dead.
    destructive: false
    outcome: no_finding
  - category: abstain
    description: Intent cannot be established safely from the supplied evidence.
    destructive: false
    outcome: abstain
threshold:
  minimumConfidence: 0.6
  severity: warning
verification: Re-run knip at the review ref and confirm the finding is gone.
---

Knip is the detector, not the reviewer. A finding is a candidate to adjudicate,
never an instruction to delete.

Decide *why* the symbol is unused and the intended correction before any repair
is proposed: genuinely dead code to remove, code that should have been wired up,
a missing entrypoint or reference, an intentional dynamic/framework use, or a
half-implemented feature. Abstain when intent cannot be established from the
supplied evidence.
