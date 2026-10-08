---
id: canonical-ownership
title: Canonical ownership
executionProfile: semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - related-tests
  - repository-search
detectors: []
outcomes:
  - category: duplicate-authority
    disposition: finding
    destructive: false
  - category: misplaced-lifecycle
    disposition: finding
    destructive: false
  - category: question-owner
    disposition: question
    destructive: false
  - category: single-authority
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.75
  severity: warning
---

# Canonical ownership

Every durable fact, process lifecycle, configuration decision, and operation should have an identifiable authoritative owner. Prefer reading that authority rather than maintaining a second registry, snapshot, cache, daemon, state machine, or protocol that silently competes with it.

Ask: **who owns this fact or action, and what makes another copy necessary?** Distributed copies are legitimate when the system has a real offline, latency, durability, or isolation requirement, and when their synchronization and failure semantics are explicit. An independent copy created for convenient orchestration is not.

Follow the actual write path, read path, and failure/restart path. Flag authoritative-looking data that cannot be reconciled, silently diverges, or survives past its owning lifecycle. A common UI or API facade does not imply common ownership of the underlying components.

This reviewer owns the authority decision. `accidental-complexity` owns the cost of machinery; `dependency-direction` owns package-level dependency layering; `single-responsibility` owns whether a unit remains coherent, including lifecycle that no longer shares its identity; `change-completeness` owns cleaning up a replaced authority.

## Canonical examples

### Static copy of repository membership

A service checks in a list of enabled repositories even though the authenticated GitHub organization membership is the accepted source of truth.

Expected: `finding / duplicate-authority`

Expected review feedback:

> This file is a competing registry for repository access. Resolve membership from the owning GitHub source and specify refresh/error behavior instead of treating checked-in names as authority.

### Lifecycle moved into a second owner

A controller starts a subprocess indirectly through a separately supervised side service, although the owning application could start and supervise it itself and no isolation requirement demands a second service.

Expected: `finding / misplaced-lifecycle`

Expected review feedback:

> The extra service splits subprocess ownership and creates another restart/reconciliation path without a required boundary. Keep the child lifecycle with the process that owns it.

### Legitimate cache

A read-only cache accelerates repeated calls, has a documented time-to-live, and invalidates after mutation; the remote service remains authoritative.

Expected: `no_finding / single-authority`

Expected review feedback: none.

### Ambiguous ownership

Two services both write the same job state and the patch does not show a reconciliation contract.

Expected: `question / question-owner`

Expected review feedback:

> Which service is authoritative for job state when writes conflict or one restarts? Establish the owner and failure semantics before adding another writer.
