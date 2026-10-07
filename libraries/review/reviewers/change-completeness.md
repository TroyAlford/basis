---
id: change-completeness
title: Change completeness
executionProfile: frontier-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - related-tests
  - repository-search
detectors: []
outcomes:
  - category: stale-competing-path
    disposition: finding
    destructive: false
  - category: incomplete-migration
    disposition: finding
    destructive: false
  - category: misleading-documentation
    disposition: finding
    destructive: false
  - category: clarify-transition
    disposition: question
    destructive: false
  - category: coherent-change
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.75
  severity: warning
---

# Change completeness

A change is complete when the repository has **one coherent current story**. Replacing an architecture, public surface, lifecycle, or naming model requires handling old callers, runtime paths, configuration, tests, fixtures, generated surfaces, and documentation that still assert the superseded design.

Review the changed area plus repository references to the replaced concepts. A deletion is part of delivery when the old mechanism would remain live, authoritative-looking, callable, documented as current, or dangerous. Do not require cleanup of unrelated historical records, archived migrations, or deliberately supported compatibility paths.

Distinguish actual migration/compatibility obligations from cosmetic tidiness. If old and new paths intentionally coexist, require an explicit owner, selection rule, compatibility horizon, and failure behavior rather than reflexively demanding deletion.

This reviewer focuses on **transition coherence**. `canonical-ownership` determines which path should own the capability; `dead-code` detects unreachable symbols; documentation is reviewed as part of executable operational truth.

## Canonical examples

### Architectural reset leaves the old entry point live

A patch replaces cross-user process launching with one application-owned sandbox, but the previous privileged launcher and routes remain callable.

Expected: `finding / stale-competing-path`

Expected review feedback:

> The old launcher is still an executable path to the superseded model. Remove or explicitly disable its route and lifecycle as part of this change, rather than maintaining two operating architectures.

### New public API but old consumers

A package replaces `auth` with `oauth`, yet consumers and documentation still import the old surface without an intentional compatibility policy.

Expected: `finding / incomplete-migration`

Expected review feedback:

> The new API is not the whole migration. Update call sites and the documented consumer entry point, or state and test the deliberate compatibility period.

### Docs describe a discarded constraint

Current architecture runs one service as one owner; the setup documentation still instructs operators to provision sudo broker rules for the removed process model.

Expected: `finding / misleading-documentation`

Expected review feedback:

> The operational instructions describe the deleted broker architecture. Update them with the actual service owner and startup path so operators are not directed to recreate obsolete privileges.

### Intentional compatibility

An old endpoint remains as a documented forwarding alias, with a deprecation window and tests proving equivalent semantics.

Expected: `no_finding / coherent-change`

Expected review feedback: none.
