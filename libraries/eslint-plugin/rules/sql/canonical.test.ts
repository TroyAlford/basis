/* eslint-disable @stylistic/max-len -- SQL fixtures need long lines. */
import { describe, expect, test } from 'bun:test'
import { formatSQL } from './format'

/** Format valid SQL or fail the test. */
function formatted(source: string): string {
  const result = formatSQL(source)
  expect(result.status).toBe('formatted')
  return result.status === 'formatted' ? result.sql : ''
}

describe('SQL canonical formatting', () => {
  test('quotes lowercase, snake_case, camelCase, PascalCase, and uppercase identifiers', () => {
    expect(formatted(`
      select id, user_name, userId, DisplayName, STATUS from user_accounts
    `)).toMatchIndented(`
      SELECT "id", "user_name", "userId", "DisplayName", "STATUS"
      FROM "user_accounts"
    `)
  })

  test('quotes qualified identifiers and aliases', () => {
    expect(formatted(`
      select u.id as userId, u.displayName as name from user_accounts u where u.isActive = true
    `)).toMatchIndented(`
      SELECT "u"."id" AS "userId", "u"."displayName" AS "name"
      FROM "user_accounts" "u"
      WHERE "u"."isActive" = true
    `)
  })

  test('preserves quoted identifier spelling', () => {
    expect(formatted(`
      select "workspace.id", "Display Name", "userId" from "UserAccount"
    `)).toMatchIndented(`
      SELECT "workspace.id", "Display Name", "userId"
      FROM "UserAccount"
    `)
  })

  test('keeps literals, parameters, operators, and keywords unquoted', () => {
    expect(formatted(`
      select id from users where active = true and name = 'Alice' and age >= 18 and id = $1
    `)).toMatchIndented(`
      SELECT "id"
      FROM "users"
      WHERE "active" = true
        AND "name" = 'Alice'
        AND "age" >= 18
        AND "id" = $1
    `)
  })

  test('quotes identifiers but not built-in SQL types', () => {
    expect(formatted(`
      create table users (id uuid primary key, displayName varchar(255) not null, age integer, createdAt timestamp with time zone)
    `)).toMatchIndented(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY,
        "displayName" VARCHAR(255) NOT NULL,
        "age" INTEGER,
        "createdAt" TIMESTAMP WITH TIME ZONE
      )
    `)
  })

  test('quotes constraint names and referenced columns', () => {
    expect(formatted(`
      create table orders (id uuid primary key, userId uuid not null, constraint orders_user_fk foreign key (userId) references users(id))
    `)).toMatchIndented(`
      CREATE TABLE "orders" (
        "id" UUID PRIMARY KEY,
        "userId" UUID NOT NULL,
        CONSTRAINT "orders_user_fk" FOREIGN KEY ("userId") REFERENCES "users"("id")
      )
    `)
  })

  test('quotes index names, tables, and indexed columns', () => {
    expect(formatted(`
      create unique index users_email_idx on users (email)
    `)).toMatchIndented(`
      CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email")
    `)
  })

  test('quotes CTE names and their references', () => {
    expect(formatted(`
      with activeUsers as (select id, userName from users where active = true) select id, userName from activeUsers
    `)).toMatchIndented(`
      WITH "activeUsers" AS (
        SELECT "id", "userName"
        FROM "users"
        WHERE "active" = true
      )
      SELECT "id", "userName"
      FROM "activeUsers"
    `)
  })

  test('quotes INSERT columns, conflict targets, and RETURNING identifiers', () => {
    expect(formatted(`
      insert into users (id, userName) values ($1, $2) on conflict (id) do update set userName = excluded.userName returning id
    `)).toMatchIndented(`
      INSERT INTO "users" ("id", "userName")
      VALUES
        ($1, $2)
      ON CONFLICT ("id") DO UPDATE SET "userName" = "excluded"."userName"
      RETURNING "id"
    `)
  })

  test('quotes UPDATE and DELETE identifiers', () => {
    expect(formatted(`
      update users set displayName = $1 where userId = $2 returning id
    `)).toMatchIndented(`
      UPDATE "users"
      SET "displayName" = $1
      WHERE "userId" = $2
      RETURNING "id"
    `)

    expect(formatted(`
      delete from users where userId = $1 returning id
    `)).toMatchIndented(`
      DELETE FROM "users"
      WHERE "userId" = $1
      RETURNING "id"
    `)
  })

  test('uses canonical casing for built-in functions', () => {
    expect(formatted(`
      select count(*), sum(amount), coalesce(displayName, 'Unknown'), lower(email) from users
    `)).toMatchIndented(`
      SELECT COUNT(*), SUM("amount"), COALESCE("displayName", 'Unknown'), LOWER("email")
      FROM "users"
    `)
  })

  test('keeps user-defined function names lowercase and unquoted', () => {
    expect(formatted(`
      select calculate_total(amount), public.normalize_name(displayName) from orders
    `)).toMatchIndented(`
      SELECT calculate_total("amount"), public.normalize_name("displayName")
      FROM "orders"
    `)
  })

  test('quotes identifiers inside nested queries and joins', () => {
    expect(formatted(`
      select u.id from users u join orders o on o.userId = u.id where o.amount > (select avg(amount) from orders)
    `)).toMatchIndented(`
      SELECT "u"."id"
      FROM "users" "u"
      JOIN "orders" "o" ON "o"."userId" = "u"."id"
      WHERE "o"."amount" > (
        SELECT AVG("amount")
        FROM "orders"
      )
    `)
  })

  test('keeps nested SELECT alias scopes lexical', () => {
    expect(formatted(`
      select (select x.id from nested_table x), X.id from outer_table X
    `)).toMatchIndented(`
      SELECT
        (
          SELECT "x"."id"
          FROM "nested_table" "x"
        ),
        "X"."id"
      FROM "outer_table" "X"
    `)
  })
})
