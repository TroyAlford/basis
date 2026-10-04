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
  /** Extra hostnames allowed through; loopback and Google Fonts are always allowed. */
  allow?: string[],
  /** Fulfil these external URLs locally instead of blocking them. */
  stubs?: Record<string, StubResponse | string>,
}

/**
 * Hosts every test may reach, in addition to loopback.
 *
 * Google Fonts serves the type the Basis docs are designed around. Allowing it
 * by default renders text with the real web fonts instead of falling back to
 * whatever `sans-serif`/`monospace` resolves to on the host, which differs
 * between machines and made snapshots host-dependent. Consumers get the same
 * deterministic type without maintaining an allow-list of their own.
 */
export const DEFAULT_ALLOWED_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]

/**
 * Decide whether a request may reach the network.
 *
 * Loopback and {@link DEFAULT_ALLOWED_HOSTS} are always reachable; callers may
 * add more through {@link NetworkOptions.allow}.
 * @param url - The request URL.
 * @param options - Allowed hosts and stubs.
 * @returns True when the request may proceed.
 */
export const isRequestAllowed = (url: string, options: NetworkOptions = {}): boolean => {
  const allowed = new Set(['127.0.0.1', 'localhost', ...DEFAULT_ALLOWED_HOSTS, ...(options.allow ?? [])])
  try {
    return allowed.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Make a page deterministic.
 *
 * Every request is blocked unless it targets loopback, Google Fonts, or an
 * allowed host, so a snapshot cannot silently depend on a CDN while still
 * rendering the real web type; a request listed in `stubs` is fulfilled locally
 * instead. Registration order is deliberate: the catch-all is installed first,
 * so a later stub wins for the URLs it matches.
 * @param page - The page to constrain.
 * @param options - Allowed hosts and stubs.
 */
export async function installNetwork(page: Page, options: NetworkOptions = {}): Promise<void> {
  await page.route('**', route => (
    isRequestAllowed(route.request().url(), options) ? route.continue() : route.abort()
  ))

  for (const [url, response] of Object.entries(options.stubs ?? {})) {
    const stub = typeof response === 'string' ? { body: response } : response
    await page.route(url, route => route.fulfill({
      body: stub.body,
      contentType: stub.contentType ?? 'text/javascript',
      status: 200,
    }))
  }
}
