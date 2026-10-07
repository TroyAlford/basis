---
id: accidental-complexity
title: Accidental complexity
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - package-manifest
  - repository-search
detectors: []
outcomes:
  - category: simplify-mechanism
    disposition: finding
    destructive: false
  - category: use-existing-primitive
    disposition: finding
    destructive: false
  - category: remove-unnecessary-configuration
    disposition: finding
    destructive: false
  - category: question-complexity
    disposition: question
    destructive: false
  - category: proportionate
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Accidental complexity

Prefer the smallest coherent mechanism that satisfies the actual requirement.

Complexity inherent to the problem is necessary. Complexity introduced by the chosen solution is a cost and must buy something concrete: correctness, comprehension, reuse, testing, ownership, security, or maintainability.

Review new concepts such as wrappers, adapters, daemons, registries, configuration, feature flags, state machines, persistence, process managers, privilege transitions, custom protocols, and installation machinery.

Do not justify machinery merely because it makes a design more general, configurable, uniform, or theoretically extensible.

Prefer existing language, package-manager, runtime, operating-system, and repository primitives when they already express the requirement cleanly.

Useful defaults include:

- package dependency over custom toolchain;
- PATH resolution over executable-path configuration;
- derived state over another configuration value;
- local state over unnecessary global state;
- Unix permissions over an application privilege protocol;
- an ordinary function or concrete implementation over a framework with one implementation;
- a small local branch over an extension system for hypothetical variants.

Do not add configuration for a choice the software can safely derive or treat conventionally.

Do not create an abstraction solely to make unlike things look uniform. A unified UI or API does not require unified ownership, lifecycle, storage, or runtime underneath it.

Watch for complexity cascades: one mechanism requires another mechanism, then an adapter, exception, migration, or recovery path. When several supporting concepts exist only because of one earlier design choice, review the originating choice instead of accepting each downstream piece independently.

Ask:

> What requirement makes this machinery necessary?

If removing or changing an assumption eliminates substantial machinery without losing required behavior, prefer the simpler design.

Do not mistake fewer lines for simplicity. A longer direct implementation may be simpler than a short implementation resting on a large abstraction stack.

Necessary complexity is valid. Distributed coordination, compatibility boundaries, security protocols, performance requirements, genuine substitution, and difficult external contracts may require substantial machinery. Do not flag complexity merely because it exists.

When intent, scale, ownership, or roadmap determines whether the complexity is justified, use `question-complexity` rather than manufacturing a finding.

Keep this reviewer distinct from nearby policies:

- `readability-over-cleverness` owns whether code is harder to read than the problem requires;
- `interface-boundaries` owns whether a contract or seam is earned;
- `dryness` owns duplicate implementations of the same concept;
- `single-responsibility` owns whether a unit remains coherent.

This reviewer owns whether the solution as a whole introduces unnecessary mechanisms or concepts.

## Canonical examples

### Configurable executable path with no requirement

```ts
const docker = env.DOCKER_BIN ?? 'docker'
await run(docker, ['compose', 'up'])
```

There is no supported alternate Docker implementation or deployment layout.

Expected: `finding / remove-unnecessary-configuration`

Expected review feedback:

> Docker is already a host command resolved through PATH. `DOCKER_BIN` adds a configuration contract without buying a required capability. Invoke `docker` normally unless this project actually supports alternate executable locations.

### Custom machinery replacing an existing primitive

```ts
interface ProcessOwner {
  user: string
  requestStart(): Promise<void>
}
```

A privileged daemon implements this contract solely so one service can launch a process under another Unix account.

Expected: `finding / use-existing-primitive`

Expected review feedback:

> The requirement is execution under a different Unix identity. Unix already provides that boundary. Run the owning service as that identity instead of adding a privilege-brokering protocol unless cross-user launching is itself a requirement.

### Uniform abstraction hiding different ownership

```ts
interface Runtime {
  start(): Promise<void>
  stop(): Promise<void>
}

class Pm2Runtime implements Runtime {}
class SystemdRuntime implements Runtime {}
```

The abstraction exists only so one control plane can claim ownership of processes that naturally belong to different security domains.

Expected: `finding / simplify-mechanism`

Expected review feedback:

> The common `Runtime` surface is creating orchestration complexity rather than representing a real interchangeable capability. Keep each process with its natural owner instead of forcing unrelated lifecycles through one runtime abstraction.

### Real necessary complexity

A replicated job processor includes leases, retries, idempotency keys, and recovery because workers can crash and jobs may execute concurrently.

Expected: `no_finding / proportionate`

The machinery corresponds directly to real failure modes of the problem.
