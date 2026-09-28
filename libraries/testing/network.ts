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
