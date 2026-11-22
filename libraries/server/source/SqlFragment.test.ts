import { describe, expect, test } from 'bun:test'
import { sqlConcat, sqlFragment } from './SQL'

describe('SQL fragments', () => {
  test('renders nested structural fragments once', () => {
    const fragments = Array.from({ length: 12 }, (_, index) => sqlFragment`${index}`)
    const composed = sqlConcat(fragments, ',')
    expect(composed.sql).toBe('$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12')
    expect(composed.values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const appended = sqlConcat([
      sqlFragment`"root"."id" = ${'00000000-0000-4000-8000-000000000001'}`,
      composed,
    ])
    expect(appended.sql).toBe(
      '"root"."id" = $1 $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13',
    )
    expect(appended.values).toHaveLength(13)
  })
})
