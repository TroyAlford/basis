# Basis testing

The single test surface for Basis and its consumers: DOM component testing with the shared `render`, `Simulate`, and `waitFor` helpers, the `matchScreenshot` visual helper, and browser-backed screenshot and end-to-end lanes.

## Setup

Add the preload to the consumer's `bunfig.toml`:

```toml
[test]
preload = ["basis/testing/bun"]
```

It registers happy-dom, every matcher, and the shared browser lifecycle. A plain `bun test` runs the fast test lane; the screenshot and end-to-end lanes run only when their command names them.

## Test lanes

A test file's suffix selects its lane. Bun's default discovery runs only `.test` and `.spec`, so cheap model, DOM, and mounted-component tests stay in the fast command; screenshot and end-to-end lanes stay opt-in. Basis recognizes every lane for caller attribution, test registration, and snapshot pruning — it does not make an expensive lane a default test.

| Suffix                                                  | Purpose                                                                                             | Default `bun test`? | Canonical command  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| `*.test.ts` / `*.test.tsx` (including `*.dom.test.tsx`) | Pure model/store/server tests and mounted Basis component tests via `render`, `Simulate`, `waitFor` | Yes                 | `bun test`         |
| `*.screenshot.tsx` / `*.screenshot.ts`                  | Component-level visual contracts via `matchScreenshot`; no application mount                        | No                  | `test:screenshots` |
| `*.e2e.ts` / `*.e2e.tsx`                                | Feature-level `useApplication().visit()` journeys in a real browser; may capture screenshots        | No                  | `test:e2e`         |

The consumer scripts follow the same shape:

```json
{
  "scripts": {
    "test": "bun test",
    "test:screenshots": "bun test ./source/visual/captures/*.screenshot.tsx",
    "test:e2e": "bun test ./source/e2e/*.e2e.ts",
    "test:all": "bun run test && bun run test:screenshots && bun run test:e2e"
  }
}
```

Explicit file paths execute the custom suffixes under the pinned Bun version. Shell-expanded `*` globs work when a lane lives in a flat directory, such as `./source/visual/captures/*.screenshot.tsx`; for a nested tree, pass the files explicitly (Basis's own lane scripts collect them with `find`). Do not add `[test].pathIgnorePatterns` or `--path-ignore-patterns`. Keep `[test] preload = ["basis/testing/bun"]`; the preload supplies the shared browser lifecycle and pruning. The reference CI workflow runs `test:screenshots` and `test:e2e` as separate steps in the impact-selected Visual job. `test:all` is deliberate full acceptance, not the ordinary edit loop.

Visual snapshots assert appearance; mounted component tests assert behavior; end-to-end journeys validate actual browser and integration boundaries.

Visual snapshots capture Chromium inside Docker. Install Docker and make sure the daemon is running before `test:screenshots` or `test:e2e`; the snapshot runtime starts one pinned `mcr.microsoft.com/playwright` container and never launches a host browser.

## Temp directories

The preload isolates the process temp directory: it points `TMPDIR` / `TMP` / `TEMP` at one run-scoped root, so `os.tmpdir()` — and therefore `mkdtemp`, any dependency that calls it, and any spawned child — writes inside that root. The preload removes the root when the run ends, including on a failed test, a thrown error, or `SIGINT` / `SIGTERM`, so nothing is left behind and no per-repo or per-file setup is needed.

For a fixture that wants a named directory, `tempDirectory(prefix)` is the explicit primitive:

```ts
import { tempDirectory } from 'basis/testing'

const directory = tempDirectory('my-fixture')
```

It creates a fresh directory under the same isolated root, so plain `mkdtemp(os.tmpdir())` and `tempDirectory` are cleaned up alike. The optional second `base` argument places the run root under a different directory, for the rare fixture a tool resolves only below the working tree; a base the run created is removed again once empty.

## DOM testing

```tsx
import { render } from 'basis/testing'

const { find, instance, node } = await render(<Button>Save</Button>)
```

`render`, `Simulate`, and `waitFor` are available from `basis/testing`.

## Visual snapshots

```tsx
// Button.screenshot.tsx
import { Button } from 'basis/react'
import { matchScreenshot, test } from 'basis/testing'

test('renders a button', async () => {
  await matchScreenshot(<Button>Save</Button>)
})
```

Visual captures live in `*.screenshot.tsx` (or `*.screenshot.ts`) and are not discovered by the default `bun test`; run `bun run test:screenshots` (or name the file explicitly) to capture or compare them. Mounted component tests that assert behavior stay in `*.test.tsx`, where the fast command discovers them.

`matchScreenshot(subject, hint?, options?)` is a plain async function — not an `expect.extend` matcher — because Bun drives async matchers synchronously on its event loop, which makes the Playwright calls inside them dramatically slower than the same calls awaited normally. It accepts a React element, a Playwright `Page`, or a `Locator`. A React element is rendered to HTML, the component styles and the default theme are inlined, and the capture is cropped to the rendered content; a page is captured at its viewport and a locator at its element box.

Element captures share one deterministically configured page — each capture replaces the document — and each capture keeps its Playwright round-trips to the minimum (wait for fonts and measure in one `evaluate`, then screenshot). Application `visit`s still open a fresh browser context per visit, so app and element captures stay isolated where it matters without paying for a new context per screenshot. Both paths share the same run-scoped runtime: **one Docker container and one browser per lane run**, started on the first capture and torn down once when the run ends. Either way it mirrors `toMatchSnapshot`:

- no snapshot exists → the capture is written and the call resolves;
- a snapshot exists → a new capture is compared; a mismatch throws with the diff kept in memory and writes nothing to disk;
- `--update-snapshots` (or `UPDATE_SNAPSHOTS=1`) rewrites the snapshot.

A committed baseline is **never** modified or deleted unless the run explicitly updates (`--update-snapshots` / `UPDATE_SNAPSHOTS=1`). A browser-launch failure, missing Playwright system dependency, timeout, rendering failure, comparison failure, or ordinary test failure leaves every baseline byte-for-byte unchanged; a comparison failure writes nothing at all, and a capture failure writes nothing at all.

Obsolete snapshots are pruned only when updating. After an updating run, any committed snapshot in a test file's `__screenshots__` directory that no test referenced is removed, so a renamed or deleted capture cannot linger. Pruning is scoped to files whose entire suite executed: a file filtered with `-t`, or one containing a skipped test, keeps its snapshots. A passing comparison also clears any legacy `*.actual.png` / `*.diff.png` a pre-memory run left behind.

### Naming

Snapshots are keyed the same way Bun keys text snapshots — by the test name plus an optional hint and a per-key counter:

```text
__screenshots__/Button.screenshot.tsx/renders-a-button-1.png
```

Import `test`, `it`, and `describe` from `basis/testing` so the current test name is tracked (Bun does not expose it to the snapshot helper). Pass a hint (`matchScreenshot(element, 'primary')`) to disambiguate multiple captures in one test, exactly like `toMatchSnapshot('hint')`.

## Application tests

Boot the real server **once for the run** and drive it in Chromium:

```tsx
// Deck.e2e.ts
import { matchScreenshot, test, useApplication } from 'basis/testing'

test('renders the application', async () => {
  const app = await useApplication({ entry: './src/serve.ts' })

  await app.visit('/deck', async page => {
    await matchScreenshot(page.locator('.deck-builder'))
  })
})
```

Application journeys live in `*.e2e.ts` (or `*.e2e.tsx`) and run with `bun run test:e2e`, not the default test command. `useApplication({ entry })` spawns the entry on a free loopback port and waits for readiness on `/health`. It is **run-scoped**: memoised per `(cwd, entry)` on `globalThis`, so every test file in the run shares one server (concurrent callers await the same boot instead of racing), and the testing preload stops it exactly once when the run ends — success, failure, thrown error, or `SIGINT`/`SIGTERM`. No test file needs `afterAll` or `finally`, and the server boots once per run rather than once per file.

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

Basis's own docs site is captured this way in `libraries/testing/docs.e2e.ts` (a Button example and the icon grid), which keeps the fixture honest.

Rasterisation is pinned by the container image, and the default comparison budget tolerates the greater of 10 pixels or 0.1%, so one committed snapshot holds across machines. Tighten or loosen it per call with `maxDiffPixels` / `maxDiffPixelRatio`.

## Browsers

Snapshot capture runs Chromium inside the pinned Playwright container (`mcr.microsoft.com/playwright:v<installed playwright>-noble`). The runtime starts exactly one container per test run, connects to it once, and removes it when the run ends — locally and in CI. The container provides the browser and its operating-system libraries, so no host Chromium or `playwright install-deps` step is needed. Web fonts still load from Google Fonts over the network, as they do everywhere else.

`basis/testing` resolves the installed Playwright version and runs the mounted Playwright package's `run-server` inside the container, publishing it to a random localhost port. It connects once with `chromium.connect`, exposing the client's loopback so the containerised browser can reach the application server. Nothing is fixed or shared across runs: the container has no name, the host port is random, and the only cross-process state is the container id the run owns. Set `BASIS_SNAPSHOT_ACTIVITY_LOG` to a path to record the runtime's lifecycle events; `libraries/testing/runtime.lifecycle.test.ts` uses it to prove one container start, one browser connection, and one teardown across several files and dozens of snapshots.

The pre-commit hook runs the fast, deterministic checks (lint, typecheck, and build); `bun test` runs the fast lane, and `test:all` is the deliberate full acceptance run.
