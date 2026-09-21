---
id: test-strategy
title: Test strategy
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - related-tests
  - repository-search
detectors: []
outcomes:
  - category: expensive-critical-coverage
    disposition: finding
    destructive: false
  - category: mocked-integration
    disposition: finding
    destructive: false
  - category: missing-system-proof
    disposition: finding
    destructive: false
  - category: consider-test-seam
    disposition: question
    destructive: false
  - category: appropriate-test-level
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# Test strategy

The purpose of tests is confidence: prove that important code does what we
expect, and does not do what we expect it not to do. Optimize for the cheapest
deterministic signal that provides the required confidence.

Test important behavior at the lowest-cost level that meaningfully proves it.
Use more expensive integration and end-to-end tests only for properties that
cannot be established lower in the stack. This is not "unit tests good,
integration tests bad."

For code fully under our control with little or no dependency surface, direct
unit tests should exercise meaningful paths comprehensively. A small utility
with branches can reasonably have complete meaningful path coverage because the
signal is cheap. Test both positive and negative behavior: what the code should
do and what it should not do.

As dependencies accumulate, mocking is appropriate when the thing being proven
is the unit's behavior against an expected collaborator contract. Elaborate
mocks can cross a line: if the test mostly proves that a fake universe was
recreated correctly, it no longer gives strong confidence about the real
behavior. When the claim is that two real components work together, test those
real components together.

True end-to-end tests remain necessary for system properties that lower-level
tests cannot establish:

- the deployed application starts;
- configuration is valid;
- login actually works;
- real infrastructure wiring is reachable;
- critical user flows operate in the assembled system.

These tests should generally be the smallest part of the suite because they are
the most expensive, stateful, slow, and difficult to make deterministic. A large
mocked test suite does not prove that production can actually boot.

Important behavior that can only be tested by booting the entire application,
talking to a real external system, or running a prohibitively expensive
environment is a design signal. It may be worth introducing a small seam,
dependency-injection point, extraction, or other architecture change if that
lets important behavior be tested cheaply and frequently. Do not prescribe a
seam automatically; the abstraction must make the system simpler overall. When a
structural change is the real fix, name the smell here but leave the structural
recommendation to the reviewer that owns it.

Strong smells:

- important business logic whose primary proof is only a full end-to-end path;
- high-value logic whose tests are so slow, expensive, or flaky that they are
  not routinely run;
- enormous mock graphs required to exercise otherwise ordinary behavior;
- mocks reproducing meaningful implementation logic rather than replacing a
  boundary;
- integration or end-to-end tests repeatedly proving detailed business rules
  that could be proven much more cheaply at a lower level;
- unit tests claiming to prove that real components interoperate while every
  collaborator is mocked;
- no real smoke or integration check where the actual risk is deployment,
  configuration, or wiring;
- important branches with no affordable deterministic coverage.

Comprehensive confidence does not mean proving the same behavior at every layer.
Each higher layer should add signal the lower layer cannot provide:

- unit tests -> detailed business and algorithmic behavior;
- integration tests -> real boundaries and components actually cooperate;
- smoke and end-to-end tests -> the assembled, deployed system actually
  functions.

Coverage is evidence, not the goal. Confidence is the goal; do not turn a
coverage percentage into the reviewer.

Use `appropriate-test-level` when coverage is proportionate, and `abstain` only
when the available evidence cannot support a review at all.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### Important rules proven only end-to-end

```ts
export function priceFor(order: Order): Money {
  if (order.total.gte(money('10000'))) return order.total.times(0.9)
  if (order.customer.isMember) return order.total.times(0.95)
  return order.total
}
```

```ts
// pricing.e2e.test.ts
test('member discount', async () => {
  const app = await startApplication()
  await app.database.seedMemberWithTotal('10000')
  const response = await app.request('/orders/1/receipt')
  expect(await response.text()).toContain('95.00')
  await app.stop()
})
```

The discount rules are only proven by booting the application and a database.

Expected: `finding / expensive-critical-coverage`

Expected review feedback:

> The discount rules are important business logic, but their only proof boots the
> application and a database. Test `priceFor` directly across the branches and
> edge cases, and keep the end-to-end flow for wiring rather than the rules.

### A mock that reimplements the collaborator

```ts
class FakeUserRepository {
  findById(id: string): User {
    return { id, displayName: `user-${id}` }
  }
}

test('service displays a user', async () => {
  const service = new UserService(new FakeUserRepository())
  expect(await service.display('1')).toBe('user-1')
})
```

The fake reimplements query behavior, so the test mostly proves the fake.

Expected: `finding / mocked-integration`

Expected review feedback:

> This test claims the service and repository work together, but the fake
> reimplements the repository's query semantics. Test the real repository
> against a real store, or mock only the boundary without encoding query logic.

### Proportionate direct coverage

```ts
export function parseAmount(input: string): number | null {
  const normalized = input.trim().replace(/,/g, '')
  if (normalized.length === 0) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}
```

```ts
test('parses plain numbers', () => expect(parseAmount('10')).toBe(10))
test('parses thousands separators', () => expect(parseAmount('1,000')).toBe(1000))
test('returns null for empty input', () => expect(parseAmount('  ')).toBeNull())
test('returns null for non-numeric input', () => expect(parseAmount('abc')).toBeNull())
```

Expected: `no_finding`

Expected review feedback: none.
