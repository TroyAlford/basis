/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { formatSQL } from './format'
import { sqlSemanticTree, verifySemantics, verifySqlSemantics } from './verify'

const FIXTURES = [
  'select id, name, created_at from widgets where active = true and owner_id = $1 order by name',
  'select * from widgets w left join other o on o.id = w.id where w.a = 1 or w.b = 2',
  'select distinct id, count(*) from widgets group by id order by id desc limit 10 offset 2',
  "select case when status = 'a' then 1 when status = 'b' then 2 else 0 end as rank, name from widgets",
  "select coalesce(array_length(array_remove(string_to_array(trim(coalesce(text, '')), ' '), ''), 1), 0) as word_count from posts",
  'select exists (select 1 from widgets where active = true) as present',
  'select * from widgets where name like \'a%\' and id in (1, 2) and id between 1 and 3',
  'select * from widgets w cross join other o',
  'select * from widgets w join other o using (id)',
  'select * from (select id from widgets) as w',
  'select * from generate_series(1, 10) with ordinality as g(value, n)',
  "insert into widgets (id, name) values (1, 'a'), (2, 'b') on conflict (id) do update set name = excluded.name returning id, name",
  "update widgets set name = 'x', active = false where id = $1 returning id",
  'delete from widgets where id = $1 returning id',
  'create table if not exists widgets (id uuid primary key default gen_random_uuid(), name varchar(255) not null, owner_id varchar(255) not null references accounts(id), unique(owner_id, name))',
  'create unique index "Pet_guardian_fk_idx" on "Pet" using btree("guardian.id") where false',
  'create trigger "t" before insert on "Invoice" for each row execute function "f"()',
  'create view active_widgets as select id, name from widgets where active = true',
  'with recursive widget_tree as (select id, parent_id from widgets where parent_id is null union all select w.id, w.parent_id from widgets w join widget_tree t on w.parent_id = t.id) select * from widget_tree',
  'select -1, 1e3, \'It\'\'s\', "Name" from t',
  'create sequence public.basis_fault_once start 1',
  'alter table "Article" disable row level security',
  'set constraints all immediate',
  'analyze "Person"',
  'drop index "Pet_owner_fk_idx"',
]

describe('formatter semantics', () => {
  for (const sql of FIXTURES) {
    test(`preserves meaning: ${sql.slice(0, 48)}`, () => {
      const result = formatSQL(sql)
      expect(result.status).toBe('formatted')
      if (result.status !== 'formatted') return
      expect(sqlSemanticTree(result.sql)).toEqual(sqlSemanticTree(sql))
    })
  }

  test('is idempotent for every fixture', () => {
    for (const sql of FIXTURES) {
      const once = formatSQL(sql)
      expect(once.status).toBe('formatted')
      if (once.status !== 'formatted') continue
      const twice = formatSQL(once.sql)
      expect(twice).toEqual(once)
    }
  })

  test('omits the trailing semicolon for one statement and separates multiple statements', () => {
    expect(formatSQL('select 1;')).toEqual({ sql: 'SELECT 1', status: 'formatted' })
    expect(formatSQL('select 1; select 2')).toEqual({ sql: 'SELECT 1;\n\nSELECT 2', status: 'formatted' })
  })

  test('preserves quoted identifiers, literals, and comments', () => {
    const sql = 'select "Name", \'It\'\'s\', $$dollar$$ -- keep\nfrom "Entity"'
    const result = formatSQL(sql)
    expect(result.status).toBe('formatted')
    if (result.status !== 'formatted') return
    expect(result.sql).toContain('"Name"')
    expect(result.sql).toContain("'It''s'")
    expect(result.sql).toContain('$$dollar$$')
    expect(result.sql).toContain('-- keep')
  })
})

describe('failure safety', () => {
  test('malformed SQL is invalid', () => {
    const result = formatSQL('select from')
    expect(result.status).toBe('invalid')
  })

  test('unsupported top-level SQL names the construct', () => {
    const result = formatSQL('create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)')
    expect(result).toEqual({ construct: 'DefineStmt', status: 'unsupported' })
  })

  test('unsupported nested SQL names the construct', () => {
    const result = formatSQL('select * from t where data is json')
    expect(result).toEqual({ construct: 'JsonIsPredicate', status: 'unsupported' })
  })

  test('a supported parent cannot hide an unsupported child', () => {
    const result = formatSQL('select (select data is json from t) from u')
    expect(result).toEqual({ construct: 'JsonIsPredicate', status: 'unsupported' })
  })

  test('semantic verification detects a literal change', () => {
    expect(() => verifySqlSemantics('select 1', 'select 2')).toThrow()
  })

  test('semantic verification detects an operator change', () => {
    expect(() => verifySqlSemantics('select 1 + 2', 'select 1 - 2')).toThrow()
  })

  test('semantic verification detects a predicate change', () => {
    expect(() => verifySqlSemantics('select * from t where a = 1', 'select * from t where a = 2')).toThrow()
  })

  test('semantic verification rejects swapping quoted identifier roles', () => {
    expect(() => verifySemantics(
      'SELECT "Foo" AS "foo" FROM "t"',
      'SELECT "foo" AS "Foo" FROM "t"',
    )).toThrow()
  })

  test('semantic verification permits unquoted camelCase canonicalization', () => {
    expect(() => verifySemantics(
      'select userId from t',
      'SELECT "userId" FROM "t"',
    )).not.toThrow()
  })
})
