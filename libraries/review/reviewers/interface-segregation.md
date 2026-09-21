---
id: interface-segregation
title: Interface segregation
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - direct-callers
  - repository-search
detectors: []
outcomes:
  - category: emergent-capability
    disposition: finding
    destructive: false
  - category: forced-members
    disposition: finding
    destructive: false
  - category: consider-capability
    disposition: question
    destructive: false
  - category: coherent-interface
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Interface segregation

Split interfaces when meaningful, reusable capability boundaries emerge across
multiple implementations or concepts — not merely because individual consumers
use subsets.

A consumer that uses only `findById()` and `save()` of a larger `UserRepository`
is not evidence that the interface should be split. Even many consumers each
using a different subset is not sufficient by itself. Consumer usage describes
what callers happen to need; it does not establish a reusable capability.

A capability boundary has emerged when, for example, several repository-like
things all support `findById`/`save`/`delete`, several otherwise unrelated
things support `search`, and several support export. At that point separating
`Repository`-like CRUD, `Searchable`, and `Exportable` contracts may improve
reuse, substitution, and comprehension. If there is only one coherent
`UserRepository` and consumers merely call different subsets, splitting it into
bespoke mini-interfaces creates plumbing without useful reuse.

The question: has a reusable capability boundary emerged, or would splitting
this interface merely mirror individual consumer usage?

Pressure to split includes:

- the same subset of behavior recurring across multiple different
  implementations or concepts;
- consumers needing a capability that spans otherwise unrelated concrete types;
- implementations being forced to stub, throw, or no-op methods that do not
  belong to them;
- a coherent capability becoming independently reusable or substitutable;
- the broad interface preventing meaningful composition of capabilities.

Do not report merely because a consumer does not use every method, because the
interface has many methods, or because smaller interfaces are theoretically
possible.

Keep ownership distinct: whether a shared abstraction should exist at all
belongs to `interface-boundaries`, and whether it is behaviorally truthful
belongs to `substitutability`. This reviewer owns whether an existing contract is
sliced into useful capability boundaries.

Use `coherent-interface` when the current interface is a coherent capability,
and `abstain` only when the available evidence cannot support a review at all.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### Implementations forced to disown part of the contract

```ts
interface UserRepository {
  findById(id: string): User
  save(user: User): void
  delete(id: string): void
  search(query: string): User[]
  exportCsv(): string
}

class ReadOnlyUserRepository implements UserRepository {
  search(query: string): User[] { throw new Error('not supported') }
  exportCsv(): string { throw new Error('not supported') }
  /* ... */
}
```

Expected: `finding / forced-members`

Expected review feedback:

> This implementation has to throw for `search` and `export`, which are not part
> of its capability. That is evidence the contract is too broad, not that the
> implementation is wrong. Split the capabilities.

### A reusable capability across unrelated types

```ts
class UserRepository { findById() {} save() {} delete() {} search() {} exportCsv() {} }
class ProductRepository { findById() {} save() {} delete() {} search() {} exportCsv() {} }
class AuditLogRepository { findById() {} save() {} search() {} exportCsv() {} }
```

Several otherwise unrelated stores share search and export behavior.

Expected: `finding / emergent-capability`

Expected review feedback:

> These otherwise unrelated stores share the same search and export behavior. A
> reusable capability has emerged; callers that only search or export should
> depend on that capability rather than a whole repository.

### Consumers using different subsets of one coherent interface

```ts
interface UserRepository {
  findById(id: string): User
  save(user: User): void
  delete(id: string): void
  search(query: string): User[]
  exportCsv(): string
}

class UserService {
  constructor(private readonly users: UserRepository) {}
}
```

Consumers use different subsets, but this is still one coherent capability.

Expected: `no_finding`

Expected review feedback: none.
