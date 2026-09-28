import type { Browser, BrowserContextOptions, Page } from 'playwright'

let browser: Browser | null = null

/**
 * Lazily launch (and cache) the shared Chromium instance.
 *
 * Playwright is imported dynamically so a suite that never captures a
 * screenshot (the normal, pre-commit suite) never loads the browser stack and
 * does not need a Playwright-capable host.
 * @returns The connected browser.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({
      /*
       * Deterministic rasterisation: grayscale anti-aliasing, no font hinting
       * or subpixel positioning, and portable Skia paths, so the same markup
       * renders identically across machines and architectures.
       */
      args: [
        '--disable-lcd-text',
        '--disable-font-subpixel-positioning',
        '--disable-skia-runtime-opts',
        '--font-render-hinting=none',
        '--force-color-profile=srgb',
      ],
    })
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
