/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { formatSQL } from './format'

/** Format a fixture and return its canonical SQL. */
function formatted(sql: string): string {
  const result = formatSQL(sql)
  expect(result.status).toBe('formatted')
  return result.status === 'formatted' ? result.sql : ''
}

describe('canonical layout', () => {
  test('formats SELECT clauses and attaches AND/OR to their condition', () => {
    expect(formatted('select id, name, created_at from widgets where active = true and owner_id = $1 order by name'))
      .toMatchIndented(`
        SELECT "id", "name", "created_at"
        FROM "widgets"
        WHERE "active" = true
          AND "owner_id" = $1
        ORDER BY "name"
      `)
  })

  test('formats joins and OR expressions', () => {
    expect(formatted('select * from widgets w left join other o on o.id = w.id where w.a = 1 or w.b = 2'))
      .toMatchIndented(`
        SELECT *
        FROM "widgets" "w"
        LEFT JOIN "other" "o" ON "o"."id" = "w"."id"
        WHERE "w"."a" = 1
          OR "w"."b" = 2
      `)
  })

  test('formats GROUP BY, ORDER BY, LIMIT, and OFFSET', () => {
    expect(formatted('select distinct id, count(*) from widgets group by id order by id desc limit 10 offset 2'))
      .toMatchIndented(`
        SELECT DISTINCT "id", COUNT(*)
        FROM "widgets"
        GROUP BY "id"
        ORDER BY "id" DESC
        LIMIT 10
        OFFSET 2
      `)
  })

  test('formats CASE expressions as a structural block', () => {
    expect(formatted("select case when status = 'a' then 1 when status = 'b' then 2 else 0 end as rank, name from widgets"))
      .toMatchIndented(`
        SELECT
          CASE
            WHEN "status" = 'a' THEN 1
            WHEN "status" = 'b' THEN 2
            ELSE 0
          END AS "rank",
          "name"
        FROM "widgets"
      `)
  })

  test('formats INSERT VALUES one row per line', () => {
    expect(formatted("insert into widgets (id, name) values (1, 'a'), (2, 'b')"))
      .toMatchIndented(`
        INSERT INTO "widgets" ("id", "name")
        VALUES
          (1, 'a'),
          (2, 'b')
      `)
  })

  test('formats ON CONFLICT and RETURNING', () => {
    expect(formatted("insert into widgets (id, name) values (1, 'a') on conflict (id) do update set name = excluded.name returning id, name"))
      .toMatchIndented(`
        INSERT INTO "widgets" ("id", "name")
        VALUES
          (1, 'a')
        ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"
        RETURNING "id", "name"
      `)
  })

  test('formats UPDATE and DELETE assignments', () => {
    expect(formatted("update widgets set name = 'x', active = false where id = $1 returning id"))
      .toMatchIndented(`
        UPDATE "widgets"
        SET "name" = 'x', "active" = false
        WHERE "id" = $1
        RETURNING "id"
      `)
    expect(formatted('delete from widgets where id = $1 returning id'))
      .toMatchIndented(`
        DELETE FROM "widgets"
        WHERE "id" = $1
        RETURNING "id"
      `)
  })

  test('formats CREATE TABLE columns and constraints one per line', () => {
    expect(formatted('create table if not exists widgets (id uuid primary key default gen_random_uuid(), name varchar(255) not null, owner_id varchar(255) not null references accounts(id), unique(owner_id, name))'))
      .toMatchIndented(`
        CREATE TABLE IF NOT EXISTS "widgets" (
          "id" UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
          "name" VARCHAR(255) NOT NULL,
          "owner_id" VARCHAR(255) NOT NULL REFERENCES "accounts"("id"),
          UNIQUE("owner_id", "name")
        )
      `)
  })

  test('formats indexes, triggers, sequences, and views', () => {
    expect(formatted('create unique index "Pet_guardian_fk_idx" on "Pet" using btree("guardian.id") where false'))
      .toBe('CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet" USING "btree" ("guardian.id") WHERE false')
    expect(formatted('create trigger "t" before insert on "Invoice" for each row execute function "f"()'))
      .toBe('CREATE TRIGGER "t" BEFORE INSERT ON "Invoice" FOR EACH ROW EXECUTE FUNCTION f()')
    expect(formatted('create sequence public.basis_fault_once start 1'))
      .toBe('CREATE SEQUENCE "public"."basis_fault_once" START 1')
    expect(formatted('create view active_widgets as select id, name from widgets where active = true'))
      .toMatchIndented(`
        CREATE VIEW "active_widgets" AS (
          SELECT "id", "name"
          FROM "widgets"
          WHERE "active" = true
        )
      `)
  })

  test('formats WITH and set operations', () => {
    expect(formatted('with recursive widget_tree as (select id, parent_id from widgets where parent_id is null union all select w.id, w.parent_id from widgets w join widget_tree t on w.parent_id = t.id) select * from widget_tree'))
      .toMatchIndented(`
        WITH RECURSIVE "widget_tree" AS (
          SELECT "id", "parent_id"
          FROM "widgets"
          WHERE "parent_id" IS NULL

          UNION ALL

          SELECT "w"."id", "w"."parent_id"
          FROM "widgets" "w"
          JOIN "widget_tree" "t" ON "w"."parent_id" = "t"."id"
        )
        SELECT *
        FROM "widget_tree"
      `)
  })

  test('formats quoted identifiers and literals exactly', () => {
    expect(formatted('select "Name", \'It\'\'s\', $$dollar$$, "workspace.id" from "Entity"'))
      .toBe('SELECT "Name", \'It\'\'s\', $$dollar$$, "workspace.id"\nFROM "Entity"')
  })

  test('formats comments with their structural block', () => {
    expect(formatted(`
      select id, -- stable identifier
        name -- display name
      from widgets
      -- only active widgets
      where active = true
    `)).toMatchIndented(`
      SELECT
        "id", -- stable identifier
        "name" -- display name
      FROM "widgets"
      -- only active widgets
      WHERE "active" = true
    `)
  })
})
