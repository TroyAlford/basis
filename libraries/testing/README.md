# Basis testing

The single test surface for Basis and its consumers: DOM component testing with
the shared `render`, `Simulate`, and `waitFor` helpers, the shared matchers, and
browser-backed visual snapshots.

## Setup

Add the preload to the consumer's `bunfig.toml`:

```toml
[test]
preload = ["basis/testing/bun"]
```

It registers happy-dom, every matcher, and the shared browser lifecycle, so a
plain `bun test` runs the whole suite — DOM tests and snapshots alike.

## DOM testing

```tsx
import { render } from 'basis/testing'

const { find, instance, node } = await render(<Button>Save</Button>)
```

`render`, `Simulate`, and `waitFor` are available from `basis/testing`.

## Visual snapshots

```tsx
import { expect } from 'bun:test'
import { Button } from 'basis/react'
import { test } from 'basis/testing'

test('renders a button', async () => {
  await expect(<Button>Save</Button>).toMatchScreenshot()
})
```

Snapshot tests are ordinary `*.test.*` files, so `bun test` discovers them.

`toMatchScreenshot` accepts a React element, a Playwright `Page`, or a
`Locator`. A React element is rendered to HTML, the component styles and the
default theme are inlined, and the capture is cropped to the rendered content;
a page is captured at its viewport and a locator at its element box. Either way
it mirrors `toMatchSnapshot`:

- no snapshot exists → the capture is written and the assertion passes;
- a snapshot exists → a new capture is compared; a mismatch fails and writes
  `<name>.actual.png` / `<name>.diff.png` artefacts;
- `--update-snapshots` (or `UPDATE_SNAPSHOTS=1`) rewrites the snapshot.

A committed baseline is **never** modified or deleted unless the run explicitly
updates (`--update-snapshots` / `UPDATE_SNAPSHOTS=1`). A browser-launch failure,
missing Playwright system dependency, timeout, rendering failure, comparison
failure, or ordinary test failure leaves every baseline byte-for-byte unchanged;
a comparison failure writes only the `.actual`/`.diff` artefacts, and a capture
failure writes nothing at all.

Obsolete snapshots are pruned only when updating. After an updating run, any
committed snapshot in a test file's `__screenshots__` directory that no test
referenced is removed, so a renamed or deleted capture cannot linger. Pruning is
scoped to files whose entire suite executed: a file filtered with `-t`, or one
containing a skipped test, keeps its snapshots. A passing comparison also clears
any `*.actual.png` / `*.diff.png` left behind by an earlier failure.

### Naming

Snapshots are keyed the same way Bun keys text snapshots — by the test name plus
an optional hint and a per-key counter:

```text
__screenshots__/Button.test.tsx/renders-a-button-1.png
```

Import `test`, `it`, and `describe` from `basis/testing` so the current test name
is tracked (Bun does not expose it to custom matchers). Pass a hint
(`toMatchScreenshot('primary')`) to disambiguate multiple captures in one test,
exactly like `toMatchSnapshot('hint')`.

## Application tests

Boot the real server and drive it in Chromium:

```tsx
import { expect } from 'bun:test'
import { startApplication, test } from 'basis/testing'

test('renders the application', async () => {
  const app = await startApplication({ entry: './src/serve.ts' })
  try {
    await app.visit('/deck', async page => {
      await expect(page.locator('.deck-builder')).toMatchScreenshot()
    })
  } finally {
    await app.stop()
  }
})
```

`startApplication({ entry })` spawns the entry on a free loopback port and waits
for readiness on `/health`; `stop()` is idempotent. `app.visit(path, options?, fn)`
opens a deterministic page, applies the network policy, navigates to `url + path`,
runs `fn`, then disposes the page.

Network is deterministic by default — non-loopback requests are blocked, so a
snapshot cannot silently depend on a CDN:

- `stubs` fulfils specific external URLs locally (for example a CDN module);
- `allow` lets specific hosts through.

`init(page)` runs before navigation for page setup, such as seeding storage with
Playwright's own API:

```tsx
await app.visit('/deck', {
  stubs: { 'https://esm.sh/shiki@3.0.0': shikiStub },
  init: page => page.addInitScript(value => localStorage.setItem('mtg-deck', value), deckJson),
}, async page => {
  await expect(page.locator('.deck-builder')).toMatchScreenshot()
})
```

Basis's own docs site is captured this way in `libraries/testing/docs.test.ts`
(a Button example and the icon grid), which keeps the fixture honest.

Text and Skia rasterisation are pinned (grayscale anti-aliasing, no hinting,
portable Skia), and the default comparison budget tolerates the greater of 10
pixels or 0.1%, so one committed snapshot holds across machines. Tighten or
loosen it per call with `maxDiffPixels` / `maxDiffPixelRatio`.

## Browsers

Chromium is downloaded by Basis's install hook during `bun install`. Set
`BASIS_SKIP_BROWSER_INSTALL=1` to skip that download. The complete `bun test`
suite also needs the browser's system libraries; on a bare Linux runner install
them with `bun ./node_modules/playwright/cli.js install --with-deps chromium`.
CI provisions those dependencies and runs the complete suite, which is
authoritative for the browser-backed snapshots.

The pre-commit hook runs the fast, deterministic checks (lint, typecheck, and
build) so that committing does not require a browser-capable machine; run
`bun test` locally or rely on CI for the full suite.
