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

`toMatchScreenshot` renders the element to HTML, inlines the component styles
and the default theme, captures it in headless Chromium cropped to the rendered
content, and mirrors `toMatchSnapshot`:

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

Text and Skia rasterisation are pinned (grayscale anti-aliasing, no hinting,
portable Skia), and the default comparison budget tolerates the greater of 10
pixels or 0.1%, so one committed snapshot holds across machines. Tighten or
loosen it per call with `maxDiffPixels` / `maxDiffPixelRatio`.

## Browsers

Chromium is downloaded by Basis's install hook during `bun install`, so nothing
extra is required to run snapshot tests. Set `BASIS_SKIP_BROWSER_INSTALL=1` to
skip it. On a bare Linux runner, install the browser's system libraries with
`bun ./node_modules/playwright/cli.js install --with-deps chromium`.
