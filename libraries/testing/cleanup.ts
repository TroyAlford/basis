import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotDirectory } from './snapshots'
import { fullyRunFiles } from './test'
import { updating } from './update'

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

/** Options accepted by {@link pruneSnapshots}. */
export interface PruneOptions {
  /** Directories to prune. Defaults to the fully executed test files' directories. */
  directories?: string[],
  /** Baselines to keep. Defaults to the snapshots touched during this run. */
  seen?: ReadonlySet<string>,
  /** Whether snapshots may be rewritten. Defaults to {@link updating}. */
  updating?: boolean,
}

/**
 * Prune orphaned snapshots after the run.
 *
 * Deleting a committed baseline is a destructive operation, so it happens only
 * when the run explicitly asked to update snapshots (`--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1`). A normal, failed, or browser-less run never deletes a
 * baseline. When updating, pruning is scoped to test files whose entire suite
 * executed: a file filtered with `-t`, or one containing a skipped test, is
 * skipped so its snapshots are never mistaken for orphans. Registered as a
 * preload `afterAll`.
 * @param options - Pruning overrides, used by tests; production passes none.
 * @returns The paths that were removed.
 */
export function pruneSnapshots(options: PruneOptions = {}): string[] {
  const {
    directories,
    seen = touched,
    updating: force = updating(),
  } = options

  if (!force) return []

  const targets = directories ?? fullyRunFiles().map(snapshotDirectory)
  const removed: string[] = []
  for (const directory of targets) removed.push(...pruneDirectory(directory, seen))
  return removed
}
