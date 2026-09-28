import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotDirectory } from './snapshots'
import { fullyRunFiles } from './test'

/** Committed snapshot baselines written or compared during this run. */
const touched = new Set<string>()

/**
 * Record that a committed snapshot took part in the run.
 *
 * Every snapshot the matcher writes or compares is recorded, so anything left
 * over in a test file's snapshot directory afterwards is stale.
 * @param baseline - Absolute path to the committed snapshot.
 */
export function trackSnapshot(baseline: string): void {
  touched.add(baseline)
}

/**
 * Remove the committed snapshots in a directory that no test referenced.
 *
 * Only `*.png` baselines are considered; `*.actual.png` and `*.diff.png` are
 * transient artifacts the matcher manages itself.
 * @param directory - The snapshot directory to prune.
 * @param seen - Absolute paths of snapshots touched during the run.
 * @returns The paths that were removed.
 */
export function pruneDirectory(directory: string, seen: ReadonlySet<string>): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.png')) continue
    if (entry.endsWith('.actual.png') || entry.endsWith('.diff.png')) continue
    const path = join(directory, entry)
    if (seen.has(path)) continue
    rmSync(path, { force: true })
    removed.push(path)
  }
  return removed
}

/**
 * Prune orphaned snapshots after the run.
 *
 * Scoped to test files whose entire suite executed: a file filtered with `-t`,
 * or one containing a skipped test, is skipped so its snapshots are never
 * mistaken for orphans. Registered as a preload `afterAll`.
 * @returns The paths that were removed.
 */
export function pruneSnapshots(): string[] {
  const removed: string[] = []
  for (const file of fullyRunFiles()) {
    removed.push(...pruneDirectory(snapshotDirectory(file), touched))
  }
  return removed
}
