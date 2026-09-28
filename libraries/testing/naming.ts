/**
 * Snapshot naming.
 *
 * Kept separate from the matcher so the pure key and filename formatting can be
 * unit-tested without a browser.
 */

/**
 * Format a snapshot key the way Bun formats text snapshot keys: `<test name> <n>`
 * or `<test name>: <hint> <n>`.
 * @param testName - The full test name.
 * @param hint - An optional hint disambiguating multiple snapshots.
 * @param index - The per-key counter, starting at 1.
 * @returns The snapshot key.
 */
export function formatSnapshotKey(
  testName: string,
  hint: string | undefined,
  index: number,
): string {
  const base = hint ? `${testName}: ${hint}` : testName
  return `${base} ${index}`
}

/**
 * Turn a snapshot key into a filesystem-safe, lowercase name.
 * @param value - The snapshot key.
 * @returns A kebab-cased filename stem.
 */
export function slug(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'snapshot'
}
