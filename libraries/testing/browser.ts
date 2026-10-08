/**
 * The shared, Docker-backed Playwright browser for Basis snapshot capture.
 *
 * Basis never launches a browser on the host: {@link getBrowser} connects to
 * the pinned Playwright container (`browser-container.ts`), so a capture always
 * runs in the same browser, OS, and font environment. The browser is imported
 * dynamically so a suite that never captures a screenshot never loads the
 * Playwright stack or needs Docker.
 *
 * The lifecycle state lives on `globalThis` rather than module scope: Bun gives
 * each test file its own module registry, so module-global state would connect
 * per file. One process-global registry means one connection per process, and
 * the container itself is shared across `--parallel` workers, so a whole run
 * uses a single browser container.
 */

import type { Browser, BrowserContext, BrowserContextOptions, BrowserType, Page } from 'playwright'
import { acquireSharedBrowserContainer, releaseSharedBrowserContainer } from './browser-container'

/** How long to wait for the container's Playwright server to accept connections. */
const CONNECT_TIMEOUT_MS = 60_000

/** Per-attempt connection timeout. */
const CONNECT_ATTEMPT_TIMEOUT_MS = 10_000

/** Delay between connection attempts while the container boots. */
const CONNECT_RETRY_MS = 250

/** Remediation shown when the Docker-backed browser cannot be connected. */
export const DOCKER_BROWSER_HELP =
  'Basis runs every snapshot capture through a Docker container pinned to the ' +
  'installed Playwright version. Ensure Docker is installed and running, the ' +
  'pinned image can be pulled, and `docker` is declared in this repository\'s ' +
  '`basis.hostDependencies`.'

/**
 * Wrap a connection failure with the endpoint and remediation.
 * @param endpoint - The container endpoint that would not accept a connection.
 * @param cause - The connection error.
 * @returns The augmented error.
 */
export function browserConnectError(endpoint: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Basis could not connect to its snapshot browser at ${endpoint}: ${detail}. ${DOCKER_BROWSER_HELP}`,
    { cause },
  )
}

/** Process-global capture lifecycle state. */
interface BrowserRegistry {
  /** Whether this process has acquired the shared container and must release it. */
  acquired: boolean,
  /** The connected browser, or null. */
  browser: Browser | null,
  /** The shared context for React-element captures, or null. */
  captureContext: BrowserContext | null,
  /** The shared page for React-element captures, or null. */
  capturePage: Page | null,
  /** Serialises element captures on the shared page. */
  captureQueue: Promise<unknown>,
  /** The shared container endpoint this process acquired, or null. */
  endpoint: string | null,
}

/** The `globalThis` property holding the process-wide capture registry. */
const REGISTRY_PROPERTY = '__basisTestingBrowser'

/**
 * The process-wide capture registry, created on first use.
 * @returns The shared registry.
 */
function registry(): BrowserRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[REGISTRY_PROPERTY] as BrowserRegistry | undefined
  if (existing) return existing

  const created: BrowserRegistry = {
    acquired: false,
    browser: null,
    captureContext: null,
    capturePage: null,
    captureQueue: Promise.resolve(),
    endpoint: null,
  }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Connect to the container's Playwright server, retrying while it boots.
 * @param chromium - The Playwright Chromium browser type.
 * @param endpoint - The container endpoint.
 * @returns The connected browser.
 * @throws {Error} When the server does not accept a connection in time.
 */
async function connectToContainer(chromium: BrowserType, endpoint: string): Promise<Browser> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS
  let lastError: unknown

  for (;;) {
    try {
      return await chromium.connect(endpoint, { timeout: CONNECT_ATTEMPT_TIMEOUT_MS })
    } catch (error) {
      lastError = error
      if (Date.now() >= deadline) break
      await Bun.sleep(CONNECT_RETRY_MS)
    }
  }

  throw browserConnectError(endpoint, lastError)
}

/**
 * Acquire the shared container up front, without connecting a browser.
 *
 * The preload calls this so the whole run — including any `bun test`
 * subprocesses and `--parallel` workers — shares one container, started before
 * the first test and released when the last process exits.
 * @throws {Error} When the container cannot be started.
 */
export async function warmBrowser(): Promise<void> {
  const state = registry()
  if (state.endpoint) return
  state.endpoint = await acquireSharedBrowserContainer()
  state.acquired = true
}

/**
 * Lazily connect this process's browser to the shared container.
 * @returns The connected browser.
 * @throws {Error} When Docker or the pinned image is unavailable, or the
 *   connection never succeeds.
 */
export async function getBrowser(): Promise<Browser> {
  const state = registry()
  if (state.browser && state.browser.isConnected()) return state.browser

  if (!state.endpoint) {
    state.endpoint = await acquireSharedBrowserContainer()
    state.acquired = true
  }

  const { chromium } = await import('playwright')
  try {
    state.browser = await connectToContainer(chromium, state.endpoint)
  } catch (error) {
    state.acquired = false
    state.endpoint = null
    await releaseSharedBrowserContainer()
    throw error
  }
  return state.browser
}

/**
 * Close this process's browser and release the shared container.
 *
 * The graceful close is bounded: the browser is remote, and a wedged container
 * must not hang the run's teardown. The container is removed only once every
 * process has released it.
 */
export async function closeBrowser(): Promise<void> {
  const state = registry()
  await state.captureContext?.close().catch(() => undefined)
  state.captureContext = null
  state.capturePage = null
  state.captureQueue = Promise.resolve()

  if (state.browser) {
    await Promise.race([
      state.browser.close().catch(() => undefined),
      Bun.sleep(2_000),
    ])
  }
  state.browser = null

  if (state.acquired) {
    state.acquired = false
    state.endpoint = null
    await releaseSharedBrowserContainer()
  }
}

/**
 * The one deterministically configured page reused for React-element captures.
 * @returns The shared capture page.
 */
async function getCapturePage(): Promise<Page> {
  const state = registry()
  if (state.capturePage && !state.capturePage.isClosed()) return state.capturePage

  const instance = await getBrowser()
  state.captureContext ??= await instance.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: { height: 800, width: 1280 },
  })
  state.capturePage = await state.captureContext.newPage()
  return state.capturePage
}

/**
 * Run a React-element capture on the shared page, one at a time.
 *
 * Element captures are standalone documents, so re-creating a context and page
 * per capture is pure overhead — the dominant cost of a large icon matrix.
 * Reusing one page and replacing its document is deterministic, and the queue
 * keeps concurrent test files from interleaving on it. Application `visit`s
 * still open a fresh context, so server/browser state cannot leak between them.
 * @param fn - Callback receiving the shared page.
 * @returns The callback's result.
 */
export async function withCapturePage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const state = registry()
  const run = state.captureQueue.then(async () => await fn(await getCapturePage()))
  state.captureQueue = run.catch(() => undefined)
  return await run
}

/** A viewport size. */
export interface Viewport {
  /** Viewport height in pixels. */
  height: number,
  /** Viewport width in pixels. */
  width: number,
}

/** Options for {@link withPage}. */
export interface PageOptions {
  /** Additional Playwright context options, merged over the deterministic defaults. */
  context?: BrowserContextOptions,
  /** Viewport size. Defaults to `1280x800`. */
  viewport?: Viewport,
}

/**
 * Open a deterministically configured page, run a callback, then tear it down.
 * @param fn - Callback receiving the page.
 * @param options - Context options.
 * @returns The callback's result.
 */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  options: PageOptions = {},
): Promise<T> {
  const instance = await getBrowser()
  const context = await instance.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: options.viewport ?? { height: 800, width: 1280 },
    ...options.context,
  })
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close()
  }
}
