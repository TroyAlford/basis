---
id: test-strategy
title: Test strategy
executionProfile: semantic
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
  - category: implementation-coupled-assertion
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

The purpose of tests is confidence: prove that important code does what we expect, and does not do what we expect it not to do. Optimize for the cheapest deterministic signal that provides the required confidence.

Test important behavior at the lowest-cost level that meaningfully proves it. Use more expensive integration and end-to-end tests only for properties that cannot be established lower in the stack. This is not "unit tests good, integration tests bad."

For code fully under our control with little or no dependency surface, direct unit tests should exercise meaningful paths comprehensively. A small utility with branches can reasonably have complete meaningful path coverage because the signal is cheap. Test both positive and negative behavior: what the code should do and what it should not do.

As dependencies accumulate, mocking is appropriate when the thing being proven is the unit's behavior against an expected collaborator contract. Elaborate mocks can cross a line: if the test mostly proves that a fake universe was recreated correctly, it no longer gives strong confidence about the real behavior. When the claim is that two real components work together, test those real components together.

True end-to-end tests remain necessary for system properties that lower-level tests cannot establish:

- the deployed application starts;
- configuration is valid;
- login actually works;
- real infrastructure wiring is reachable;
- critical user flows operate in the assembled system.

These tests should generally be the smallest part of the suite because they are the most expensive, stateful, slow, and difficult to make deterministic. A large mocked test suite does not prove that production can actually boot.

Important behavior that can only be tested by booting the entire application, talking to a real external system, or running a prohibitively expensive environment is a design signal. It may be worth introducing a small seam, dependency-injection point, extraction, or other architecture change if that lets important behavior be tested cheaply and frequently. Do not prescribe a seam automatically; the abstraction must make the system simpler overall. When a structural change is the real fix, name the smell here but leave the structural recommendation to the reviewer that owns it.

Strong smells:

- important business logic whose primary proof is only a full end-to-end path;
- high-value logic whose tests are so slow, expensive, or flaky that they are not routinely run;
- enormous mock graphs required to exercise otherwise ordinary behavior;
- mocks reproducing meaningful implementation logic rather than replacing a boundary;
- integration or end-to-end tests repeatedly proving detailed business rules that could be proven much more cheaply at a lower level;
- unit tests claiming to prove that real components interoperate while every collaborator is mocked;
- tests asserting private DOM, SVG, or CSS structure when the contract is model state, observable UI semantics, or screenshot-covered appearance;
- duplicate cross-layer proof of the same contract without distinct confidence;
- no real smoke or integration check where the actual risk is deployment, configuration, or wiring;
- important branches with no affordable deterministic coverage.

Comprehensive confidence does not mean proving the same behavior at every layer. Each higher layer should add signal the lower layer cannot provide:

- unit tests -> detailed business and algorithmic behavior;
- integration tests -> real boundaries and components actually cooperate;
- smoke and end-to-end tests -> the assembled, deployed system actually functions.

When the failure is at a real boundary, tests must prove the **observable behavior**, not merely that an attribute, mock, or intermediate variable has the expected value. For UI focus behavior, assert actual DOM focus after keyboard interactions; for event streams, check a real listener receives the event; for commit pinning, assert the executed checkout SHA matches the resolved SHA. Add negative cases that would distinguish the intended contract from a plausible broken implementation.

## Assert the contract, not the implementation shape

Tests should assert the contract they exist to protect, not incidental implementation shape. The DOM is a valid assertion surface when the DOM result **is** the behavior:

- focus after a keyboard interaction;
- accessible name, role, or state;
- conditional presence or absence controlled by product logic;
- permissions hiding or disabling an action;
- user-visible counts, text, or status.

A DOM assertion is a smell when it merely proxies another contract:

- asserting a private CSS class to prove a visual state renders when a screenshot already covers the appearance;
- counting SVG or icon nodes to prove appearance;
- asserting a private data attribute instead of the saved or domain state;
- asserting raw markup structure when the contract is a persisted choice plus its rendered output;
- pinning nested DOM shape, class names, or element counts that are not user-visible semantics.

Selectors used to **interact** with the application are not themselves the problem; review what the test asserts. Prefer model or state assertions for domain behavior, screenshots and visual regression for appearance and layout, and semantic or accessibility assertions for interactive UI behavior. Keep browser and end-to-end assertions for wiring and outcomes that cannot be proved lower in the stack.

Do not prove the same contract redundantly at multiple layers unless the higher layer adds distinct confidence. A screenshot plus private-DOM assertions for the same visual detail is duplicate proof, not stronger proof. Exact DOM or SVG structure is valid only when that structure is itself a public or semantic primitive contract. Exact geometry measurements are valid when dimensions, clipping, or print geometry are themselves requirements. Do not demand screenshots for nonvisual domain behavior.

This category is about the assertion surface. Important domain rules proven only through a browser test are `expensive-critical-coverage`, even when that test reads persisted fields.

Do not recommend adding `data-testid`, production classes, or other hooks merely to preserve an implementation-coupled assertion.

Coverage is evidence, not the goal. Confidence is the goal; do not turn a coverage percentage into the reviewer.

Use `appropriate-test-level` when coverage is proportionate, and `abstain` only when the available evidence cannot support a review at all.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it should give. These examples are part of the reviewer instructions.

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
  const app = await useApplication()
  await app.database.seedMemberWithTotal('10000')
  const response = await app.request('/orders/1/receipt')
  expect(await response.text()).toContain('95.00')
})
```

The discount rules are only proven by booting the application and a database.

Expected: `finding / expensive-critical-coverage`

Expected review feedback:

> The discount rules are important business logic, but their only proof boots the application and a database. Test `priceFor` directly across the branches and edge cases, and keep the end-to-end flow for wiring rather than the rules.

### A fake that reproduces the real collaborator's semantics

```ts
class FakeUserRepository {
  private readonly rows: User[] = []

  findActive(sortedBy: 'name' | 'createdAt'): User[] {
    return this.rows
      .filter(user => user.active)
      .sort((a, b) =>
        sortedBy === 'name' ? a.name.localeCompare(b.name) : a.createdAt - b.createdAt,
      )
  }

  save(user: User): void {
    this.rows.push(user)
  }
}

test('service returns active users in order', async () => {
  const repository = new FakeUserRepository()
  const service = new UserService(repository)
  await service.createMany([/* ... */])
  expect((await service.activeUsers('name')).map(user => user.name)).toEqual(['Ada', 'Grace'])
})
```

The fake reimplements the repository's filtering and sorting, and the test is offered as proof that the service and repository work together.

Expected: `finding / mocked-integration`

Expected review feedback:

> This test duplicates the repository's filtering and sorting in a fake, then treats the result as evidence that the service and repository integrate. It only proves the fake. Test the real repository against a real store, and prove the service against a contract-level fake that does not reimplement query behavior.

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

### No proof that the assembled system works

```ts
// user-service.test.ts
test('formats a user', () => { /* ... */ })

// user-repository.test.ts
test('saves and loads a user', async () => { /* real store integration */ })
```

Unit and integration coverage is good, but nothing starts the deployed application, validates its configuration, or exercises real wiring.

Expected: `finding / missing-system-proof`

Expected review feedback:

> Unit and integration coverage look solid, but there is no smoke test that the assembled application starts with valid configuration and working wiring. That is the risk this change carries; add the smallest real check for it.

### Private DOM structure standing in for a screenshot

```tsx
test('featured items show a badge', async () => {
  const { node } = await render(<Item featured />)
  expect(node.querySelectorAll('.badge-layer')).toHaveLength(1)
})
```

If the badge is visual and visual snapshots already cover it, this pins a private class rather than the contract.

Expected: `finding / implementation-coupled-assertion`

Expected review feedback:

> This asserts the private `.badge-layer` structure while the badge's appearance is already covered by screenshots. Keep the semantic decision test at its lowest useful level and leave the rendered appearance to the visual suite; do not add a test hook just to preserve this assertion.

### Conditional presence is observable behavior

```tsx
test('read-only records do not offer Edit', async () => {
  const { node } = await render(<RecordView readOnly record={record} />)
  expect(node.querySelector('[role="button"][aria-label="Edit record"]')).toBeNull()
})
```

The conditional absence is itself observable behavior, so the DOM assertion is appropriate.

Expected: `no_finding`

Expected review feedback: none.

### Appearance belongs to the screenshot suite

```tsx
test('renders the featured treatment', async () => {
  await matchScreenshot(<Item featured />, 'featured')
})
```

Visual regression proves the appearance without requiring knowledge of the internal SVG or class structure.

Expected: `no_finding`

Expected review feedback: none.

### Domain behavior tested through the editor

```ts
test('editing a record persists every field', async () => {
  const record = await seedRecord()
  await app.visit(`/records/${record.id}`, async page => {
    await page.getByRole('button', { name: 'Edit record' }).click()
    await page.getByLabel('Name').fill('Updated')
    // ...twenty more field edits
    expect(await readRecord(record.id)).toMatchObject({ /* twenty fields */ })
  })
})
```

Most of this browser assertion proves transformation rules through the editor and persisted model, while a model test could prove the same rules more cheaply.

Expected: `finding / expensive-critical-coverage`

Expected review feedback:

> Most of this browser test proves the transformation matrix through the editor and persisted fields. Test the transformation directly, keep one browser assertion that the editor wires the user's action to persistence, and let screenshots prove the rendering.
