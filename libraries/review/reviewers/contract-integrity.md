---
id: contract-integrity
title: Contract integrity
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
  - category: contract-mismatch
    disposition: finding
    destructive: false
  - category: false-success
    disposition: finding
    destructive: false
  - category: unproven-boundary
    disposition: question
    destructive: false
  - category: contract-preserved
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.75
  severity: warning
---

# Contract integrity

A system boundary is correct only when the **producer and consumer agree on observable semantics**, including error handling, identity, readiness, ordering, and provenance. Typechecks, mocked tests, or attractive API shapes cannot establish that two real components interoperate.

Inspect both ends of changed interfaces: event names and listeners; HTTP statuses and caller interpretation; persisted IDs and consumer lookup; commit SHA resolved and artifact actually executed; keyboard focus and ARIA state; transport parity; migration steps and readers. Identify the exact mismatch, not hypothetical integration risk.

Success must be truthful. A 200 response, ready health state, completed job, or verified record must never imply a property that the implementation has not established. For uncertain integration evidence, ask for a focused boundary test instead of claiming an unobserved failure. Coordinate with `test-strategy` for the cheapest real proof.

Do not demand exhaustive E2E tests. Prefer one narrowly scoped integration test that would fail if the two ends disagree.

## Canonical examples

### SSE producer and consumer disagree

The server sends `event: update`; the browser client listens only with `EventSource.onmessage`, which receives unnamed `message` events.

Expected: `finding / contract-mismatch`

Expected review feedback:

> Named `update` events will not reach `onmessage`. Align the server event name with the client listener and verify delivery with a real event stream.

### Readiness reported before initialization

A health endpoint answers ready while the first production build is still pending.

Expected: `finding / false-success`

Expected review feedback:

> This reports readiness before the service has produced the artifact it serves. Keep readiness false until initial build success, and cover the failure case.

### Boundary not established

A patch changes the callback shape consumed by another package, but the consumer source is absent from available context.

Expected: `question / unproven-boundary`

Expected review feedback:

> What consumes this callback, and has that consumer been updated to the new payload? Verify the real boundary before asserting interoperability.

### Matched contract

A producer emits named `update` events; the browser subscribes with `addEventListener('update', ...)`; an integration test verifies delivery.

Expected: `no_finding / contract-preserved`

Expected review feedback: none.
