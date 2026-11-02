import { describe, expect, test } from 'bun:test'
import { normalizeSQL, toMatchSQL } from './toMatchSQL'

expect.extend({ toMatchSQL })

describe('toMatchSQL', () => {
  test('normalizes insignificant formatting whitespace', () => {
    expect(normalizeSQL('SELECT\n\t"id",\n  "title"\nFROM "Note"'))
      .toBe('SELECT "id","title" FROM "Note"')
    expect('SELECT   "id" FROM "Note"').toMatchSQL('SELECT "id" FROM "Note"')
  })

  test('preserves quoted whitespace and meaningful differences', () => {
    expect('SELECT "a  b" FROM "Note"').not.toMatchSQL('SELECT "a b" FROM "Note"')
    expect('SELECT "a" FROM "Note"').not.toMatchSQL('SELECT "b" FROM "Note"')
    expect('SELECT "a" FROM "Note" WHERE "id" = $1')
      .not.toMatchSQL('SELECT "a" FROM "Note" WHERE "id" = $2')
  })

  test('compares ordered statement arrays', () => {
    const statements = [
      'CREATE TABLE "A" ("id" UUID)',
      'ALTER TABLE "A" ADD CONSTRAINT "A_fkey" FOREIGN KEY ("id") REFERENCES "B" ("id")',
    ]
    expect(statements).toMatchSQL(statements)
    expect(statements).not.toMatchSQL([...statements].reverse())
  })
})
