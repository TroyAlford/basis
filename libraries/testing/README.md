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
import {
  blockExternalRequests,
  seedLocalStorage,
  startApplication,
  test,
  withPage,
} from 'basis/testing'

test('renders the application', async () => {
  const app = await startApplication({ entry: './src/serve.ts' })
  try {
    await withPage(async page => {
      await seedLocalStorage(page, { 'mtg-deck': '{}' })
      await blockExternalRequests(page)
      await page.goto(app.url)
      await expect(page.locator('[data-testid="panel"]')).toMatchScreenshot()
    })
  } finally {
    await app.stop()
  }
})
```

- `startApplication` spawns `entry` on a free loopback port and waits for
  readiness on `/health`; `stop()` is idempotent.
- `withPage` opens a deterministically configured page and tears it down.
- `blockExternalRequests` aborts non-loopback requests, so snapshots do not
  depend on a CDN.
- `stubRequest(page, url, { body })` fulfils a specific request locally, for an
  external dependency that the app genuinely needs (register it after the
  blocker; later routes win).
- `seedLocalStorage` seeds state before any application script runs.

Basis's own docs site is captured this way in `libraries/testing/docs.test.ts`
(a Button example and the icon grid), which keeps the fixture honest.

Text and Skia rasterisation are pinned (grayscale anti-aliasing, no hinting,
portable Skia), and the default comparison budget tolerates the greater of 10
pixels or 0.1%, so one committed snapshot holds across machines. Tighten or
loosen it per call with `maxDiffPixels` / `maxDiffPixelRatio`.

## Browsers

Chromium is downloaded by Basis's install hook during `bun install`, so nothing
extra is required to run snapshot tests. Set `BASIS_SKIP_BROWSER_INSTALL=1` to
skip it. On a bare Linux runner, install the browser's system libraries with
`bun ./node_modules/playwright/cli.js install --with-deps chromium`.
