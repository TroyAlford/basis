# Basis testing

The single test surface for Basis and its consumers: DOM component testing with the shared `render`, `Simulate`, and `waitFor` helpers, the `matchScreenshot` visual helper, and browser-backed visual snapshots.

## Setup

Add the preload to the consumer's `bunfig.toml`:

```toml
[test]
preload = ["basis/testing/bun"]
```

It registers happy-dom, every matcher, and the shared browser lifecycle, so a plain `bun test` runs the whole suite — DOM tests and snapshots alike.

## DOM testing

```tsx
import { render } from 'basis/testing'

const { find, instance, node } = await render(<Button>Save</Button>)
```

`render`, `Simulate`, and `waitFor` are available from `basis/testing`.

## Visual snapshots

```tsx
import { Button } from 'basis/react'
import { matchScreenshot, test } from 'basis/testing'

test('renders a button', async () => {
  await matchScreenshot(<Button>Save</Button>)
})
```

Snapshot tests are ordinary `*.test.*` files, so `bun test` discovers them.

`matchScreenshot(subject, hint?, options?)` is a plain async function — not an `expect.extend` matcher — because Bun drives async matchers synchronously on its event loop, which makes the Playwright calls inside them dramatically slower than the same calls awaited normally. It accepts a React element, a Playwright `Page`, or a `Locator`. A React element is rendered to HTML, the component styles and the default theme are inlined, and the capture is cropped to the rendered content; a page is captured at its viewport and a locator at its element box.

Element captures share one deterministically configured page — each capture replaces the document — and each capture keeps its Playwright round-trips to the minimum (wait for fonts and measure in one `evaluate`, then screenshot). Application `visit`s still open a fresh browser context per visit, so app and element captures stay isolated where it matters without paying for a new context per screenshot. Either way it mirrors `toMatchSnapshot`:

- no snapshot exists → the capture is written and the call resolves;
- a snapshot exists → a new capture is compared; a mismatch throws and writes `<name>.actual.png` / `<name>.diff.png` artefacts;
- `--update-snapshots` (or `UPDATE_SNAPSHOTS=1`) rewrites the snapshot.

A committed baseline is **never** modified or deleted unless the run explicitly updates (`--update-snapshots` / `UPDATE_SNAPSHOTS=1`). A browser-launch failure, missing Playwright system dependency, timeout, rendering failure, comparison failure, or ordinary test failure leaves every baseline byte-for-byte unchanged; a comparison failure writes only the `.actual`/`.diff` artefacts, and a capture failure writes nothing at all.

Obsolete snapshots are pruned only when updating. After an updating run, any committed snapshot in a test file's `__screenshots__` directory that no test referenced is removed, so a renamed or deleted capture cannot linger. Pruning is scoped to files whose entire suite executed: a file filtered with `-t`, or one containing a skipped test, keeps its snapshots. A passing comparison also clears any `*.actual.png` / `*.diff.png` left behind by an earlier failure.

### Naming

Snapshots are keyed the same way Bun keys text snapshots — by the test name plus an optional hint and a per-key counter:

```text
__screenshots__/Button.test.tsx/renders-a-button-1.png
```

Import `test`, `it`, and `describe` from `basis/testing` so the current test name is tracked (Bun does not expose it to the snapshot helper). Pass a hint (`matchScreenshot(element, 'primary')`) to disambiguate multiple captures in one test, exactly like `toMatchSnapshot('hint')`.

## Application tests

Boot the real server **once for the run** and drive it in Chromium:

```tsx
import { matchScreenshot, test, useApplication } from 'basis/testing'

test('renders the application', async () => {
  const app = await useApplication({ entry: './src/serve.ts' })

  await app.visit('/deck', async page => {
    await matchScreenshot(page.locator('.deck-builder'))
  })
})
```

`useApplication({ entry })` spawns the entry on a free loopback port and waits for readiness on `/health`. It is **run-scoped**: memoised per `(cwd, entry)` on `globalThis`, so every test file in the run shares one server (concurrent callers await the same boot instead of racing), and the testing preload stops it exactly once when the run ends — success, failure, thrown error, or `SIGINT`/`SIGTERM`. No test file needs `afterAll` or `finally`, and the server boots once per run rather than once per file.

`startApplication({ entry })` is the low-level primitive behind it, with the same shape but a per-call lifecycle (`stop()` is idempotent). Use it only when a test needs a dedicated server of its own.

### Eager startup

`useApplication` is lazy by default, so a broken server surfaces inside whichever test first needs it. To fail at the start of the run instead, boot it from an opt-in preload — the same process-wide registry, so it does not boot a second server:

```toml
# bunfig.toml
[test]
preload = ["basis/testing/bun", "./testing/preload.ts"]
```

```ts
// testing/preload.ts
import { useApplication } from 'basis/testing'

await useApplication({ entry: './src/serve.ts' })
```

Bun evaluates each preload once before the suite, so the awaited call boots the app up front; a boot failure rejects the preload and the run fails before any test runs. Lazy and eager callers share one handle, so a test that later calls `useApplication` with the same `(cwd, entry)` reuses the booted app.

### Isolation

The browser side stays deterministic: `visit(path, options?, fn)` opens a fresh context with the network policy applied, navigates to `url + path`, runs `fn`, then disposes the page. **Server-side state is shared across the run**, so a test that needs a clean server must boot its own with `startApplication`.

Network is deterministic by default — requests are blocked unless they target loopback or Google Fonts (allowed so text renders the real web type instead of a host-dependent fallback), so a snapshot cannot silently depend on an arbitrary CDN:

- `stubs` fulfils specific external URLs locally (for example a CDN module);
- `allow` lets specific extra hosts through.

`init(page)` runs before navigation for page setup, such as seeding storage with Playwright's own API:

```tsx
await app.visit('/deck', {
  stubs: { 'https://esm.sh/shiki@3.0.0': shikiStub },
  init: page => page.addInitScript(value => localStorage.setItem('mtg-deck', value), deckJson),
}, async page => {
  await matchScreenshot(page.locator('.deck-builder'))
})
```

Basis's own docs site is captured this way in `libraries/testing/docs.test.ts` (a Button example and the icon grid), which keeps the fixture honest.

Capture runs in the pinned container, so text and Skia rasterisation — the browser build, OS libraries, and fonts — are fixed, and one committed snapshot holds across machines. The default comparison budget tolerates the greater of 10 pixels or 0.1%; tighten or loosen it per call with `maxDiffPixels` / `maxDiffPixelRatio`.

## Browsers

Snapshot capture always runs through Docker: `basis/testing` starts the pinned Playwright image (`mcr.microsoft.com/playwright:v<installed Playwright version>-noble`) running Playwright's server from the mounted Playwright package, then connects the host client to it. The container carries the browser, its operating-system libraries, and the Google fonts `BASIS_FONTS_URL` pins, so capture renders identically on every host and in CI, and a host needs only Docker — never `playwright install-deps`, `sudo`, or a matching set of system libraries. The container is started once per run and reused for every capture. Declare `docker` in `basis.hostDependencies` so `bun install` fails loudly when it is absent. The first capture pulls the image; later runs reuse it. There is no host-browser fallback — a snapshot test that cannot reach Docker fails.

The pre-commit hook runs the fast, deterministic checks (lint, typecheck, and build); run `bun test` for the complete suite.
