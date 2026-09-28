import type { Page } from 'playwright'

/** A response a {@link NetworkOptions.stubs} entry fulfils with. */
export interface StubResponse {
  /** Response body. */
  body: string,
  /** Response content type. Defaults to `text/javascript`. */
  contentType?: string,
}

/** Network policy for a page. */
export interface NetworkOptions {
  /** Extra hostnames allowed through; loopback is always allowed. */
  allow?: string[],
  /** Fulfil these external URLs locally instead of blocking them. */
  stubs?: Record<string, StubResponse | string>,
}

/**
 * Make a page deterministic.
 *
 * Every request is blocked unless it targets loopback or an allowed host, so a
 * snapshot cannot silently depend on a CDN; a request listed in `stubs` is
 * fulfilled locally instead. Registration order is deliberate: the catch-all is
 * installed first, so a later stub wins for the URLs it matches.
 * @param page - The page to constrain.
 * @param options - Allowed hosts and stubs.
 */
export async function installNetwork(page: Page, options: NetworkOptions = {}): Promise<void> {
  const allowed = new Set(['127.0.0.1', 'localhost', ...(options.allow ?? [])])
  await page.route('**', route => {
    const { hostname } = new URL(route.request().url())
    return allowed.has(hostname) ? route.continue() : route.abort()
  })

  for (const [url, response] of Object.entries(options.stubs ?? {})) {
    const stub = typeof response === 'string' ? { body: response } : response
    await page.route(url, route => route.fulfill({
      body: stub.body,
      contentType: stub.contentType ?? 'text/javascript',
      status: 200,
    }))
  }
}
