import type { Browser, BrowserContextOptions, Page } from 'playwright'
import { chromium } from 'playwright'

let browser: Browser | null = null

/**
 * Lazily launch (and cache) the shared Chromium instance.
 * @returns The connected browser.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch()
  }
  return browser
}

/**
 * Close the shared browser, if one is running.
 */
export async function closeBrowser(): Promise<void> {
  await browser?.close()
  browser = null
}

/** Options for {@link newPage}. */
export interface PageOptions {
  /** Additional Playwright context options, merged over the deterministic defaults. */
  context?: BrowserContextOptions,
  /** Viewport size. Defaults to `1280x800`. */
  viewport?: { height: number, width: number },
}

/**
 * Open a page with deterministic defaults suitable for screenshots.
 *
 * Animations are disabled at capture time by the matcher; the context fixes the
 * viewport, device scale factor, colour scheme, and reduced motion so two runs
 * on the same platform render identically.
 * @param options - Page options.
 * @returns A new Playwright page.
 */
export async function newPage(options: PageOptions = {}): Promise<Page> {
  const instance = await getBrowser()
  const context = await instance.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: options.viewport ?? { height: 800, width: 1280 },
    ...options.context,
  })
  return context.newPage()
}
