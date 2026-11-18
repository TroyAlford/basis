import { describe, expect, test } from 'bun:test'
import { SQL } from './SQL'

describe('SQL fragments', () => {
  test('rebases multi-digit placeholders and preserves values', () => {
    const fragments = Array.from({ length: 12 }, (_, index) => ({
      sql: '$1',
      values: [index],
    }))
    const composed = SQL.compose(fragments, { separator: ',' })
    expect(composed.sql).toBe('$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12')
    expect(composed.values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const appended = SQL.compose([
      { sql: '"root"."id" = $1', values: ['00000000-0000-4000-8000-000000000001'] },
      composed,
    ])
    expect(appended.sql).toBe(
      '"root"."id" = $1 $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13',
    )
    expect(appended.values).toHaveLength(13)
  })

  test('respects an explicit first placeholder index', () => {
    const composed = SQL.compose(
      [{ sql: 'a = $1 AND b = $2', values: ["O'Brien", 42] }],
      { startIndex: 10 },
    )
    expect(composed.sql).toBe('a = $10 AND b = $11')
    expect(composed.values).toEqual(["O'Brien", 42])
  })

  test('binds fragment values through one caller binder', () => {
    const values: unknown[] = []
    const bind = (value: string | number | boolean | bigint | Date): string => {
      values.push(value)
      return `$${values.length}`
    }
    const sql = SQL.bindFragment(
      { sql: 'a = $1 AND b = $2 AND c = $1', values: ["O'Brien", 42] },
      bind,
    )
    expect(sql).toBe('a = $1 AND b = $2 AND c = $3')
    expect(values).toEqual(["O'Brien", 42, "O'Brien"])
  })
})
