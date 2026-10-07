---
id: requirement-fidelity
title: Requirement fidelity
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
  - category: unrequired-mechanism
    disposition: finding
    destructive: false
  - category: missing-required-behavior
    disposition: finding
    destructive: false
  - category: clarify-requirement
    disposition: question
    destructive: false
  - category: faithful
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.75
  severity: warning
---

# Requirement fidelity

Review whether the change implements the **actual stated requirement**, rather than an invented implementation plan. Requirement, acceptance criteria, explicit steering decisions, and the current architecture take precedence over historical design suggestions. A proposal, prior implementation, or ticket's suggested mechanism is not automatically a requirement.

Distinguish **what must be true** from **how someone proposed to achieve it**. Flag a new service, registry, protocol, persistence layer, security domain, or migration only when the resulting obligation does not follow from the required behavior and imposes concrete cost. Conversely, a superficially elegant simplification that drops an accepted behavior is a finding.

Read the ticket, acceptance criteria, architectural steering, and directly relevant code or call sites before claiming a mismatch. Do not invent missing requirements or infer them from preferences. When the authoritative intent is unavailable or conflicting, ask or abstain; never declare the change wrong solely because you would choose a different design.

When the actual requirement is met but the mechanism is excessive, mention the mismatch here and let `accidental-complexity` own the detailed design critique. When a behavior is missing, explain which exact requirement is unfulfilled.

## Canonical examples

### Mechanism mistaken for requirement

Requirement: start a sandboxed worker with no access to parent-service secrets. The patch introduces a second privileged daemon, a custom RPC protocol, and persistent broker state, although the existing service can directly start the sandbox with an explicit environment allowlist.

Expected: `finding / unrequired-mechanism`

Expected review feedback:

> The requirement is isolated worker execution without inherited secrets; it does not call for a separately privileged broker or persistent protocol. The existing owner can launch the sandbox with an explicit environment. Explain a concrete boundary requiring this machinery or keep the ownership local.

### An essential behavior silently dropped

Acceptance criterion: the PR preview must run the *reviewed head commit*. The implementation resolves a SHA but later checks out the branch name, allowing it to move.

Expected: `finding / missing-required-behavior`

Expected review feedback:

> The checkout can advance independently of the resolved SHA. Anchor checkout to that commit, otherwise the accepted immutable-preview requirement is not met.

### Unclear intent

A requested "health endpoint" does not say whether it means liveness or readiness, and the patch returns success during initial build.

Expected: `question / clarify-requirement`

Expected review feedback:

> Is this endpoint intended to mean process liveness or service readiness? If callers use it as readiness, success before the initial build completes would be misleading.

### Faithful minimal delivery

A task requires displaying the current status. The implementation reads the existing authoritative status and renders it without adding parallel state.

Expected: `no_finding / faithful`

Expected review feedback: none.
