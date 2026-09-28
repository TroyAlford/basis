import type { Page } from 'playwright'

/** Options for {@link blockExternalRequests}. */
export interface BlockExternalOptions {
  /** Extra hostnames that remain reachable, in addition to loopback. */
  allow?: string[],
}

/**
 * Abort every request that is not served from loopback or an allowed host.
 *
 * Keeps snapshots offline-deterministic: a component that fetches a CDN fails
 * loudly instead of rendering differently run to run.
 * @param page - The page to constrain.
 * @param options - Allowed hosts.
 */
export async function blockExternalRequests(
  page: Page,
  options: BlockExternalOptions = {},
): Promise<void> {
  const allowed = new Set(['127.0.0.1', 'localhost', ...(options.allow ?? [])])
  await page.route('**', route => {
    const { hostname } = new URL(route.request().url())
    return allowed.has(hostname) ? route.continue() : route.abort()
  })
}

/** Response served by {@link stubRequest}. */
export interface StubOptions {
  /** Response body. */
  body: string,
  /** Response content type. Defaults to `text/javascript`. */
  contentType?: string,
}

/**
 * Fulfil matching requests with a fixed response.
 *
 * Use for an external dependency that would otherwise hit the network, so the
 * capture is deterministic. Register after {@link blockExternalRequests}: a
 * later route takes precedence for the URLs it matches.
 * @param page - The page to stub for.
 * @param url - URL glob or pattern to match.
 * @param options - Response body and content type.
 */
export async function stubRequest(
  page: Page,
  url: string | RegExp,
  options: StubOptions,
): Promise<void> {
  await page.route(url, route => route.fulfill({
    body: options.body,
    contentType: options.contentType ?? 'text/javascript',
    status: 200,
  }))
}
