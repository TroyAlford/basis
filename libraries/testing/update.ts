/**
 * Whether the run was explicitly asked to rewrite snapshots.
 *
 * This is the single gate for every operation that creates or replaces a
 * committed baseline. Nothing in the snapshot pipeline may delete or rewrite an
 * existing baseline unless this is true, so a failed or browser-less run can
 * never mutate committed files.
 * @returns True when `--update-snapshots` or `UPDATE_SNAPSHOTS=1` is set.
 */
export function updating(): boolean {
  return process.argv.includes('--update-snapshots') || process.env.UPDATE_SNAPSHOTS === '1'
}
