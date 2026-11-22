import { describe, expect, test } from 'bun:test'
import { sqlConcat, sqlFragment, sqlValue } from './SQL'

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

test('treats ordinary objects and arrays as bound values', () => {
  const object = { sql: 'not a fragment', values: [1] }
  const array = ['a', 'b']
  const objectQuery = sqlFragment`SELECT ${object}`
  expect(objectQuery.sql).toBe('SELECT $1')
  expect(objectQuery.values).toEqual([object])

  const arrayQuery = sqlFragment`SELECT ${array}`
  expect(arrayQuery.sql).toBe('SELECT $1')
  expect(arrayQuery.values).toEqual([array])

  const explicit = sqlConcat([sqlFragment`a = ${'x'}`, sqlFragment`b = ${'y'}`], ' AND ')
  expect(explicit.sql).toBe('a = $1 AND b = $2')
  expect(explicit.values).toEqual(['x', 'y'])
  expect(sqlValue(1).sql).toBe('$1')
})
