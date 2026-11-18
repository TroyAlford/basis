import type { BoundScalar } from './SQL'

/**
 * Rebase positional placeholders in one SQL fragment.
 * @param sql - SQL fragment containing `$1`, `$2`, … placeholders.
 * @param offset - Number of placeholders preceding this fragment.
 * @returns SQL with rebased placeholders.
 */
export function shiftPlaceholders(sql: string, offset: number): string {
  if (offset === 0) return sql
  return sql.replace(/\$(\d+)\b/gu, (_match, value: string) => (
    `$${offset + Number(value)}`
  ))
}

/**
 * Replace positional placeholders with values from the canonical SQL binder.
 * @param sql - SQL fragment containing `$1`, `$2`, … placeholders.
 * @param values - Values indexed by placeholder number.
 * @param bind - Canonical binding function.
 * @returns SQL with bound placeholders.
 */
export function bindPlaceholders(
  sql: string,
  values: readonly unknown[],
  bind: (value: BoundScalar) => string,
): string {
  return sql.replace(/\$(\d+)\b/gu, (_match, index: string) => (
    bind(values[Number(index) - 1] as BoundScalar)
  ))
}
