import type { Page } from 'playwright'

/**
 * Seed `localStorage` before any application script runs.
 *
 * Uses an init script, so the values are present on the first navigation
 * regardless of how the app reads them.
 * @param page - The page to seed.
 * @param values - Entries to write.
 */
export async function seedLocalStorage(
  page: Page,
  values: Record<string, string>,
): Promise<void> {
  await page.addInitScript((entries: [string, string][]) => {
    for (const [key, value] of entries) localStorage.setItem(key, value)
  }, Object.entries(values))
}
