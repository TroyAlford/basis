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

  test('preserves dollar-quoted string contents', () => {
    expect('SELECT $$a  b$$').not.toMatchSQL('SELECT $$a b$$')
    expect('SELECT $tag$a  b$tag$').not.toMatchSQL('SELECT $tag$a b$tag$')
    expect('SELECT\n  $$a  b$$').toMatchSQL('SELECT $$a  b$$')
  })

  test('preserves line-comment termination and statement structure', () => {
    expect('SELECT 1 -- ignored\nFROM demo')
      .not.toMatchSQL('SELECT 1 -- ignored FROM demo')
    expect('SELECT\n  1 -- ignored\nFROM   demo')
      .toMatchSQL('SELECT 1 -- ignored\nFROM demo')
  })

  test('preserves escaped quotes inside escape strings', () => {
    expect(String.raw`SELECT E'a\'  b'`)
      .not.toMatchSQL(String.raw`SELECT E'a\' b'`)
    expect(String.raw`SELECT
      E'a\'  b'`).toMatchSQL(String.raw`SELECT E'a\'  b'`)
  })

  test('preserves nested block-comment contents', () => {
    expect('SELECT /* outer /* inner */ a  b */ 1')
      .not.toMatchSQL('SELECT /* outer /* inner */ a b */ 1')
    expect('SELECT\n  /* outer /* inner */ a  b */\n  1')
      .toMatchSQL('SELECT /* outer /* inner */ a  b */ 1')
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
