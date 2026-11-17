import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { parseSync } from 'libpg-query'
import { formatSQL, sqlTemplateFormat } from './sqlTemplateFormat'

/**
 * Lint and fix one JavaScript fixture.
 * @param code - Fixture source.
 * @returns Lint and fix result.
 */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-template-format': sqlTemplateFormat } } },
    rules: { 'test/sql-template-format': 'error' },
  }], { filename: 'fixture.js' })
}

/**
 * Extract the SQL body from a formatted tagged-template fixture.
 * @param output - Fixed fixture source.
 * @returns Template body.
 */
function templateBody(output: string): string {
  return output.slice(output.indexOf('`') + 1, output.lastIndexOf('`'))
}

/**
 * Normalize a SQL statement's parsed meaning for equivalence checks.
 * @param sql - SQL text.
 * @returns Parsed statements without source locations.
 */
function semantics(sql: string): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(value)) {
        if (key === 'location' || key === 'stmt_location' || key === 'stmt_len'
          || key.endsWith('_start') || key.endsWith('_end')) continue
        result[key] = strip(child)
      }
      return result
    }
    return value
  }
  return strip(parseSync(sql).stmts.map(statement => statement.stmt))
}

describe('formatSQL', () => {
  describe('statements', () => {
    test('omits a single trailing semicolon', () => {
      expect(formatSQL('select 1;')).toMatchIndented('SELECT 1')
    })

    test('keeps semicolons and separates multiple statements', () => {
      expect(formatSQL('select 1; select 2')).toMatchIndented(`
        SELECT 1;
        
        SELECT 2
      `)
    })
  })

  describe('select', () => {
    test('formats clauses and indents AND/OR', () => {
      expect(formatSQL(`
        select id, name, created_at from widgets where active = true and owner_id = $1 order by name
      `)).toMatchIndented(`
        SELECT "id", "name", "created_at"
        FROM "widgets"
        WHERE "active" = true
          AND "owner_id" = $1
        ORDER BY "name"
      `)
    })
  })

  describe('create view', () => {
    test('formatting a formatted view is a no-op', () => {
      const once = formatSQL('create view active_widgets as select id from widgets')
      expect(formatSQL(once)).toBe(once)
    })

    test('wraps the query body in indented parentheses', () => {
      expect(formatSQL(`
        create view active_widgets as select id, name from widgets where active = true
      `)).toMatchIndented(`
        CREATE VIEW "active_widgets" AS (
          SELECT "id", "name"
          FROM "widgets"
          WHERE "active" = true
        )
      `)
    })
  })

  describe('cte', () => {
    test('indents the CTE body and separates set operators', () => {
      expect(formatSQL(`
        with recursive widget_tree as (
          select id, parent_id from widgets where parent_id is null
          union all
          select w.id, w.parent_id from widgets w
          join widget_tree t on w.parent_id = t.id
        )
        select * from widget_tree
      `)).toMatchIndented(`
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
  })

  describe('plpgsql', () => {
    test('preserves function parameters and defaults', () => {
      expect(formatSQL(`
        create function add_one(value integer, label text default 'x') returns integer as $$
        begin
          return value + 1;
        end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION add_one("value" INTEGER, "label" TEXT DEFAULT 'x') RETURNS INTEGER AS $$
        BEGIN
          RETURN value + 1;
        END
        $$ LANGUAGE plpgsql
      `)
    })

    test('formats a trigger body with IF/ELSIF/ELSE', () => {
      expect(formatSQL(`
        create or replace function set_status() returns trigger as $$
        begin
          if new.status is null then new.status = 'pending';
          elsif new.status = '' then new.status = 'pending';
          else new.status = lower(new.status);
          end if;
          return new;
        end $$ language plpgsql;
      `)).toMatchIndented(`
        CREATE OR REPLACE FUNCTION set_status() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.status IS NULL THEN
            NEW.status = 'pending';
          ELSIF NEW.status = '' THEN
            NEW.status = 'pending';
          ELSE
            NEW.status = LOWER(NEW.status);
          END IF;
        
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
      `)
    })

    test('wraps long RETURN chains', () => {
      expect(formatSQL(`
        create or replace function f() returns trigger as $$
        begin
          return setweight(to_tsvector('english', coalesce(new.name, '')), 'A')
            || setweight(to_tsvector('english', coalesce(new.slug, '')), 'B')
            || setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
        end $$ language plpgsql;
      `)).toMatchIndented(`
        CREATE OR REPLACE FUNCTION f() RETURNS TRIGGER AS $$
        BEGIN
          RETURN
            SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.name, '')), 'A')
            || SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.slug, '')), 'B')
            || SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.body, '')), 'C');
        END
        $$ LANGUAGE plpgsql;
      `)
    })

    test('preserves PL/pgSQL assignment operators and array types', () => {
      expect(formatSQL(`
        create or replace function compute() returns trigger as $$
        begin
          new.vectors := compute_vectors(new.name, new.aliases);
          return new;
        end $$ language plpgsql;
      `)).toMatchIndented(`
        CREATE OR REPLACE FUNCTION compute() RETURNS TRIGGER AS $$
        BEGIN
          NEW.vectors := compute_vectors(NEW.name, NEW.aliases);
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
      `)
    })

    test('formats a standalone DO block with comments', () => {
      const once = formatSQL(`
        do $$ begin
          if exists (select 1 from widgets where active = true) then
            -- disable
            update widgets set active = false;
          end if;
        end $$
      `)
      expect(once).toMatchIndented(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM widgets WHERE active = true) THEN
            -- disable
            UPDATE "widgets" SET "active" = false;
          END IF;
        END
        $$
      `)
      expect(formatSQL(once)).toBe(once)
    })

    test('formats DECLARE and EXCEPTION blocks', () => {
      expect(formatSQL(`
        create or replace function validate_widget() returns trigger as $$
        declare message text;
        begin
          if new.status is null then raise exception 'missing status'; end if;
          return new;
        exception
          when others then raise notice 'failed'; return null;
        end $$ language plpgsql;
      `)).toMatchIndented(`
        CREATE OR REPLACE FUNCTION validate_widget() RETURNS TRIGGER AS $$
        DECLARE
          message TEXT;
        BEGIN
          IF NEW.status IS NULL THEN
            RAISE EXCEPTION 'missing status';
          END IF;
        
          RETURN NEW;
        EXCEPTION
          WHEN others THEN
            RAISE NOTICE 'failed';
            RETURN NULL;
        END
        $$ LANGUAGE plpgsql;
      `)
    })
  })

  describe('plpgsql targets', () => {
    test('preserves EXECUTE INTO targets and RAISE parameters', () => {
      expect(formatSQL(`
        create function f() returns void as $$
        declare present text;
        begin
          select 'x' into present from t;
          raise exception 'bad %', present;
        end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS VOID AS $$
        DECLARE
          present TEXT;
        BEGIN
          SELECT 'x'
          INTO present
          FROM "t";
          RAISE EXCEPTION 'bad %', present;
        END
        $$ LANGUAGE plpgsql
      `)
      expect(formatSQL(`
        create function f() returns text as $$
        declare present text;
        begin
          execute 'select 1' into present using 1;
          return present;
        end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS TEXT AS $$
        DECLARE
          present TEXT;
        BEGIN
          EXECUTE 'select 1' INTO present USING 1;
          RETURN PRESENT;
        END
        $$ LANGUAGE plpgsql
      `)
    })
  })

  describe('operators', () => {
    test('keeps PostgreSQL JSON operators intact', () => {
      expect(formatSQL('select * from widgets where data @> $1 and tags <@ $2')).toMatchIndented(`
        SELECT *
        FROM "widgets"
        WHERE "data" @> $1
          AND "tags" <@ $2
      `)
    })
  })

  describe('nested calls', () => {
    test('breaks long calls and keeps short nested calls inline', () => {
      expect(formatSQL(`
        select coalesce(
          array_length(
            array_remove(string_to_array(trim(coalesce(text, '')), ' '), ''),
            1
          ),
          0
        ) as word_count from posts
      `)).toMatchIndented(`
        SELECT COALESCE(
          ARRAY_LENGTH(
            ARRAY_REMOVE(STRING_TO_ARRAY(TRIM(COALESCE("text", '')), ' '), ''),
            1
          ),
          0
        ) AS "word_count"
        FROM "posts"
      `)
    })
  })

  describe('case', () => {
    test('emits SELECT before a leading CASE item', () => {
      expect(formatSQL(`
        select case when status = 'a' then 1 else 0 end as rank, name from widgets
      `)).toMatchIndented(`
        SELECT
          CASE
            WHEN "status" = 'a' THEN 1
            ELSE 0
          END AS "rank",
          "name"
        FROM "widgets"
      `)
    })

    test('formats a case expression in a select list', () => {
      expect(formatSQL(`
        select id,
          case
            when status = 'a' then 1
            when status = 'b' then 2
            else 0
          end as rank
        from widgets
      `)).toMatchIndented(`
        SELECT
          "id",
          CASE
            WHEN "status" = 'a' THEN 1
            WHEN "status" = 'b' THEN 2
            ELSE 0
          END AS "rank"
        FROM "widgets"
      `)
    })
  })

  describe('comments', () => {
    test('keeps inline and full-line comments with their blocks', () => {
      expect(formatSQL(`
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

  describe('idempotence', () => {
    test('formatting a formatted query is a no-op', () => {
      const once = formatSQL(`
        with widget_tree as (
          select id, parent_id from widgets where parent_id is null
          union all
          select w.id, w.parent_id from widgets w
          join widget_tree t on w.parent_id = t.id
        )
        select * from widget_tree
      `)
      expect(formatSQL(once)).toBe(once)
    })
  })

  describe('aliases', () => {
    test('preserves alias case and quoted aliases', () => {
      expect(formatSQL('select count(*)::int as count from widgets')).toMatchIndented(`
        SELECT COUNT(*)::int AS "count"
        FROM "widgets"
      `)
      expect(formatSQL('select id as "someKeyword", name as keyword from widgets')).toMatchIndented(`
        SELECT "id" AS "someKeyword", "name" AS "keyword"
        FROM "widgets"
      `)
    })
  })

  describe('insert', () => {
    test('puts one VALUES row per line and keeps the relation spacing', () => {
      expect(formatSQL(`
        insert into "Entity" ("id", "name", "entity") values ('1', 'User', 'SystemUser'), ('2', 'Novel', 'Novel')
      `)).toMatchIndented(`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          ('1', 'User', 'SystemUser'),
          ('2', 'Novel', 'Novel')
      `)
    })
  })

  describe('dispatch', () => {
    test('formats PL/pgSQL control statements', () => {
      expect(formatSQL(`
        create function f() returns void as $$ begin perform 1; end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS VOID AS $$
        BEGIN
          PERFORM 1;
        END
        $$ LANGUAGE plpgsql
      `)
    })

    test('formats function options', () => {
      expect(formatSQL(`
        create function f() returns integer language plpgsql stable security definer
        set search_path = pg_catalog as $$ begin return 1; end $$
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS INTEGER
          STABLE
          SECURITY DEFINER
          SET search_path TO pg_catalog
        AS $$
        BEGIN
          RETURN 1;
        END
        $$ LANGUAGE plpgsql
      `)
    })

    test('formats DDL and DML clauses', () => {
      expect(formatSQL('alter table widgets add column name text')).toMatchIndented(`
        ALTER TABLE "widgets" ADD COLUMN "name" TEXT
      `)
      expect(formatSQL(`
        update widgets set name = 'x' from other where widgets.id = other.id
      `)).toMatchIndented(`
        UPDATE "widgets" SET "name" = 'x'
        FROM "other"
        WHERE "widgets"."id" = "other"."id"
      `)
      expect(formatSQL(`
        delete from widgets using other where widgets.id = other.id
      `)).toMatchIndented(`
        DELETE FROM "widgets"
        USING "other"
        WHERE "widgets"."id" = "other"."id"
      `)
      expect(formatSQL(`
        create trigger trg before insert on widgets for each row
        when (true) execute function fn()
      `)).toMatchIndented(`
        CREATE TRIGGER "trg"
        BEFORE INSERT ON "widgets"
        FOR EACH ROW
        WHEN (true)
          EXECUTE FUNCTION fn()
      `)
      expect(formatSQL(`
        insert into widgets (id) values (1) on conflict (id) where id > 0 do nothing
      `)).toMatchIndented(`
        INSERT INTO "widgets" ("id")
        VALUES
          (1)
        ON CONFLICT ("id") WHERE "id" > 0 DO NOTHING
      `)
    })

    test('formats CREATE TABLE clauses', () => {
      expect(formatSQL('create table child (id int) inherits (parent)')).toMatchIndented(`
        CREATE TABLE "child" (
          "id" INT
        ) INHERITS ("parent")
      `)
      expect(formatSQL(`
        create table events (id int, created_at date) partition by range (created_at)
      `)).toMatchIndented(`
        CREATE TABLE "events" (
          "id" INT,
          "created_at" DATE
        )
        PARTITION BY RANGE ("created_at")
      `)
      expect(formatSQL('create table widgets (id int) with (fillfactor=70)')).toMatchIndented(`
        CREATE TABLE "widgets" (
          "id" INT
        )
        WITH ("fillfactor" = 70)
      `)
    })

    test('formats CREATE VIEW options and check options', () => {
      expect(formatSQL(`
        create view v with (security_barrier=true) as select 1 as id
      `)).toMatchIndented(`
        CREATE VIEW "v" WITH ("security_barrier" = 'true') AS (
          SELECT 1 AS "id"
        )
      `)
      expect(formatSQL('create view v as select 1 as id with check option')).toMatchIndented(`
        CREATE VIEW "v" AS (
          SELECT 1 AS "id"
        ) WITH CASCADED CHECK OPTION
      `)
    })

    test('formats PL/pgSQL declarations with initialization or CONSTANT', () => {
      expect(formatSQL(`
        create function f() returns integer as $$
        declare max_attempts constant integer := 3; counter integer := 1;
        begin counter := counter + 1; return counter; end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS INTEGER AS $$
        DECLARE
          max_attempts CONSTANT INTEGER := 3;
          counter INTEGER := 1;
        BEGIN
          counter := counter + 1;
          RETURN COUNTER;
        END
        $$ LANGUAGE plpgsql
      `)
    })

    test('formats GET DIAGNOSTICS statements', () => {
      expect(formatSQL(`
        create function f() returns void as $$
        declare n integer;
        begin
          get diagnostics n = row_count;
          get stacked diagnostics n = pg_context;
        end $$ language plpgsql
      `)).toMatchIndented(`
        CREATE FUNCTION f() RETURNS VOID AS $$
        DECLARE
          n INTEGER;
        BEGIN
          GET DIAGNOSTICS n = ROW_COUNT;
          GET STACKED DIAGNOSTICS n = PG_CONTEXT;
        END
        $$ LANGUAGE plpgsql
      `)
    })

    test('reports an unsupported statement without emitting a fix', () => {
      const sql = 'create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)'
      const formatted = formatSQL(sql)
      expect(formatted).toBe(sql)
      expect(() => parseSync(formatted)).not.toThrow()
    })

    test('preserves meaning across representative formatted statements', () => {
      const statements = [
        'select id, name from widgets where active = true and owner_id = $1',
        'insert into widgets (id, name) values (1, \'a\') ' +
          'on conflict (id) do update set name = excluded.name returning id',
        'create table widgets (id uuid primary key default gen_random_uuid(), ' +
          'owner_id text not null references accounts(id), unique(owner_id))',
        'create view active_widgets as select id from widgets where active = true',
        'update widgets set name = \'x\' from other where widgets.id = other.id returning id',
        'delete from widgets using other where widgets.id = other.id returning id',
      ]
      for (const sql of statements) {
        const formatted = formatSQL(sql)
        expect(semantics(formatted)).toEqual(semantics(sql))
        expect(formatSQL(formatted)).toBe(formatted)
      }
    })

    test('keeps unsupported SQL unchanged for the rule boundary', () => {
      const sql = 'create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)'
      expect(formatSQL(sql)).toBe(sql)
    })

    test('formats row expressions', () => {
      expect(formatSQL('select row(1, 2)')).toMatchIndented(`
        SELECT ROW(1, 2)
      `)
    })
  })

  describe('actual corpus statements', () => {
    test('formats DROP FUNCTION and grants', () => {
      expect(formatSQL('drop function if exists basis.has_role(text, text) cascade')).toMatchIndented(`
        DROP FUNCTION IF EXISTS "basis"."has_role"(TEXT, TEXT) CASCADE
      `)
      expect(formatSQL('grant usage on schema app to role1, role2')).toMatchIndented(`
        GRANT USAGE ON SCHEMA "app" TO "role1", "role2"
      `)
      expect(formatSQL('grant select, insert on all tables in schema app to public')).toMatchIndented(`
        GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA "app" TO PUBLIC
      `)
      expect(formatSQL('revoke all on function basis.f(text, text) from public cascade')).toMatchIndented(`
        REVOKE ALL ON FUNCTION "basis"."f"(TEXT, TEXT) FROM PUBLIC CASCADE
      `)
    })

    test('formats extension, policy, transaction, and session statements', () => {
      expect(formatSQL('create schema if not exists basis')).toMatchIndented(`
        CREATE SCHEMA IF NOT EXISTS "basis"
      `)
      expect(formatSQL('create extension if not exists pg_trgm with schema public')).toMatchIndented(`
        CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"
      `)
      expect(formatSQL(`
        create policy p on widgets as permissive for select to public using (true)
      `)).toMatchIndented(`
        CREATE POLICY "p" ON "widgets"
          AS PERMISSIVE
          FOR SELECT
          TO PUBLIC
          USING (true)
      `)
      expect(formatSQL('alter table widgets rename to other')).toMatchIndented(`
        ALTER TABLE "widgets" RENAME TO "other"
      `)
      expect(formatSQL('begin')).toMatchIndented('BEGIN')
      expect(formatSQL('savepoint x')).toMatchIndented('SAVEPOINT "x"')
      expect(formatSQL('show search_path')).toMatchIndented('SHOW search_path')
      expect(formatSQL('close cursor_name')).toMatchIndented('CLOSE "cursor_name"')
      expect(formatSQL('reset all')).toMatchIndented('RESET ALL')
      expect(formatSQL('set local search_path to public')).toMatchIndented('SET LOCAL search_path TO "public"')
      expect(formatSQL('create index idx on t using gin(name public.gin_trgm_ops)')).toMatchIndented(`
        CREATE INDEX "idx" ON "t" USING gin("name" public.gin_trgm_ops)
      `)
      expect(formatSQL(`
        create constraint trigger trg after insert on widgets
        deferrable initially deferred for each row execute function fn()
      `)).toMatchIndented(`
        CREATE CONSTRAINT TRIGGER "trg"
        AFTER INSERT ON "widgets"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
          EXECUTE FUNCTION fn()
      `)
    })
  })

  describe('ddl and control statements', () => {
    test('formats DDL and SET statements through the AST', () => {
      expect(formatSQL('create index idx on widgets using btree(name text_pattern_ops)')).toMatchIndented(`
        CREATE INDEX "idx" ON "widgets" USING btree("name" text_pattern_ops)
      `)
      expect(formatSQL('alter table widgets disable row level security')).toMatchIndented(`
        ALTER TABLE "widgets" DISABLE ROW LEVEL SECURITY
      `)
      expect(formatSQL('drop index idx')).toMatchIndented(`
        DROP INDEX "idx"
      `)
      expect(formatSQL('drop index if exists idx')).toMatchIndented(`
        DROP INDEX IF EXISTS "idx"
      `)
      expect(formatSQL('analyze widgets')).toMatchIndented(`
        ANALYZE "widgets"
      `)
      expect(formatSQL('vacuum widgets')).toMatchIndented(`
        VACUUM "widgets"
      `)
      expect(formatSQL('create sequence public.wseq start 1')).toMatchIndented(`
        CREATE SEQUENCE "public"."wseq" START 1
      `)
      expect(formatSQL('create schema test_schema')).toMatchIndented(`
        CREATE SCHEMA "test_schema"
      `)
      expect(formatSQL(`
        create trigger trg before insert on widgets for each row execute function fn()
      `)).toMatchIndented(`
        CREATE TRIGGER "trg"
        BEFORE INSERT ON "widgets"
        FOR EACH ROW
          EXECUTE FUNCTION fn()
      `)
      expect(formatSQL('set search_path to test_schema')).toMatchIndented(`
        SET search_path TO "test_schema"
      `)
      expect(formatSQL('set constraints all immediate')).toMatchIndented(`
        SET CONSTRAINTS ALL IMMEDIATE
      `)
      expect(formatSQL('update widgets set name = \'x\' where id = 1 returning id')).toMatchIndented(`
        UPDATE "widgets" SET "name" = 'x'
        WHERE "id" = 1
        RETURNING "id"
      `)
      expect(formatSQL('delete from widgets where id = 1 returning id')).toMatchIndented(`
        DELETE FROM "widgets"
        WHERE "id" = 1
        RETURNING "id"
      `)
    })
  })

  describe('create table', () => {
    test('preserves array types', () => {
      expect(formatSQL(`
        create table widgets (tags text[] not null default '{}', ids uuid[])
      `)).toMatchIndented(`
        CREATE TABLE "widgets" (
          "tags" TEXT[] NOT NULL DEFAULT '{}',
          "ids" UUID[]
        )
      `)
    })

    test('puts one column or constraint per line', () => {
      expect(formatSQL(`
        create table if not exists widgets (
          id uuid primary key default gen_random_uuid(),
          name varchar(255) not null,
          owner_id varchar(255) not null references accounts(id),
          unique(owner_id, name)
        )
      `)).toMatchIndented(`
        CREATE TABLE IF NOT EXISTS "widgets" (
          "id" UUID PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
          "name" VARCHAR(255) NOT NULL,
          "owner_id" VARCHAR(255) NOT NULL REFERENCES "accounts" ("id"),
          UNIQUE ("owner_id", "name")
        )
      `)
    })
  })
})

describe('sqlTemplateFormat', () => {
  test('formats clauses, uppercase keywords, and indentation', () => {
    const output = lint('db.sql`SELECT * FROM "Entity" WHERE "id" = 1;`')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('db.sql`\n  SELECT *\n  FROM "Entity"\n  WHERE "id" = 1\n`')
  })

  test('preserves quoted text and interpolations', () => {
    const output = lint('sql`SELECT "Value" FROM "T" WHERE "title" = ${title}`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('"Value"')
    expect(output.output).toContain('${title}')
  })

  test('formats SQL around comments and preserves the comments', () => {
    const lineComment = lint('sql`select 1 -- where false`')
    expect(lineComment.fixed).toBe(true)
    expect(templateBody(lineComment.output)).toMatchIndented(`
      SELECT 1 -- where false
    `)

    const blockComment = lint('sql`select 1 /* where false */`')
    expect(blockComment.fixed).toBe(true)
    expect(templateBody(blockComment.output)).toMatchIndented(`
      SELECT 1 /* where false */
    `)
  })

  test('formats SQL around a dollar-quoted body and preserves the body', () => {
    const output = lint('sql`select $$a\n  b$$`')
    expect(output.fixed).toBe(true)
    expect(templateBody(output.output)).toMatchIndented(`
      SELECT $$a
        b$$
    `)
  })

  test('does not reformat interpolated expressions while wrapping SQL', () => {
    const expression = "sql.array(tag.aliasesForThisParticularlyLongFieldName, 'TEXT')"
    const tail = '${tag.anotherExtremelyLongFieldNameForTesting}, ${tag.thirdLongFieldNameForTesting}'
    const code = `const query = sql\`select \${${expression}}, ${tail}\``
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
  })

  test('preserves expression commas when formatting a multiline template', () => {
    const expression = "sql.array(tag.aliases, 'TEXT')"
    const code = `
const query = sql\`(
  \${tag.id}::text,
  \${${expression}}::text[],
  \${tag.classifierEligible}::boolean
)\`
    `.trim()
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain("${sql.array(tag.aliases, 'TEXT')}")
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
  })

  test('preserves regex literals in interpolations while wrapping SQL', () => {
    const expression = 'fn(/},/.test(value), otherArgument)'
    const tail = '${tag.anotherExtremelyLongFieldNameForTesting}, ${tag.thirdLongFieldNameForTesting}'
    const code = `const query = sql\`select \${${expression}}, ${tail}\``
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
  })

  test('preserves interpolation trivia and nested source byte-for-byte', () => {
    const tail = '${tag.anotherExtremelyLongFieldNameForTesting}, ${tag.thirdLongFieldNameForTesting}'
    const nested = '${fn(`nested ${value}`, /},/.test(value))}'
    const code = `const query = sql\`select \${/* keep */ value}, \${  spaced  }, ${nested}, ${tail}\``
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('${/* keep */ value}')
    expect(output.output).toContain('${  spaced  }')
    expect(output.output).toContain(nested)
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
    expect(lint(output.output).fixed).toBe(false)
  })

  test('preserves multiline interpolations while wrapping SQL', () => {
    const expression = 'fn(\n  value,\n  other,\n)'
    const tail = '${tag.anotherExtremelyLongFieldNameForTesting}, ${tag.thirdLongFieldNameForTesting}'
    const code = `const query = sql\`select \${${expression}}, ${tail}\``
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
  })

  test('reports an unsupported construct and does not emit a fix', () => {
    const sql = 'create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)'
    const output = lint(`sql\`${sql}\``)
    expect(output.output).toContain(sql)
    expect(output.messages.some(message => message.messageId === 'unsupportedSql')).toBe(true)
    expect(output.messages.some(message => message.fix !== undefined)).toBe(false)
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
  })

  test('accepts canonical multiline SQL', () => {
    const code = 'sql`\n  SELECT 1\n`'
    expect(lint(code).fixed).toBe(false)
  })
})

describe('parser-backed formatting', () => {
  test('formats LIKE, IN, and BETWEEN predicates', () => {
    expect(formatSQL(`
      select * from widgets where name like 'a%' and id in (1, 2) and id between 1 and 3
    `)).toMatchIndented(`
      SELECT *
      FROM "widgets"
      WHERE "name" LIKE 'a%'
        AND "id" IN (1, 2)
        AND "id" BETWEEN 1 AND 3
    `)
  })

  test('emits CROSS JOIN when a join has no condition', () => {
    expect(formatSQL('select * from widgets w cross join other o')).toMatchIndented(`
      SELECT *
      FROM "widgets" "w"
      CROSS JOIN "other" "o"
    `)
  })

  test('keeps ON CONFLICT and RETURNING clauses', () => {
    expect(formatSQL(`
      insert into widgets (id, name)
      values (1, 'a')
      on conflict (id) do update set name = excluded.name
      returning id, name
    `)).toMatchIndented(`
      INSERT INTO "widgets" ("id", "name")
      VALUES
        (1, 'a')
      ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"
      RETURNING "id", "name"
    `)
  })

  test('distinguishes built-in and application function casing', () => {
    expect(formatSQL(`
      select set_config('app.name', custom_function(id), true) as setting from widgets
    `)).toMatchIndented(`
      SELECT SET_CONFIG('app.name', custom_function("id"), true) AS "setting"
      FROM "widgets"
    `)
  })

  test('wraps a long EXISTS subquery at clause boundaries', () => {
    expect(formatSQL(`
      select exists (
        select 1 from widgets w
        where w.active = true and w.owner_id = $1 and w.name = 'x'
      ) as present
    `)).toMatchIndented(`
      SELECT EXISTS (
        SELECT 1
        FROM "widgets" "w"
        WHERE "w"."active" = true
          AND "w"."owner_id" = $1
          AND "w"."name" = 'x'
      ) AS "present"
    `)
  })

  test('breaks long joins and VALUES rows at semantic boundaries', () => {
    expect(formatSQL(`
      select 1 from widgets w join other o on w.id = o.id and w.active = true
    `)).toMatchIndented(`
      SELECT 1
      FROM "widgets" "w"
      JOIN "other" "o"
        ON "w"."id" = "o"."id"
          AND "w"."active" = true
    `)
    expect(formatSQL(`
      insert into widgets (id, name, owner, rank)
      values ('1', 'SQL', (select id from people where email = 'a@b.c'), 0)
    `)).toMatchIndented(`
      INSERT INTO "widgets" ("id", "name", "owner", "rank")
      VALUES
        (
          '1',
          'SQL',
          (SELECT "id" FROM "people" WHERE "email" = 'a@b.c'),
          0
        )
    `)
  })

  test('quotes unquoted camelCase identifiers', () => {
    expect(formatSQL('select widgetId as displayName from widgetTable where widgetId = 1')).toMatchIndented(`
      SELECT "widgetId" AS "displayName"
      FROM "widgetTable"
      WHERE "widgetId" = 1
    `)
    expect(formatSQL('insert into widgetTable (widgetId) values (1)')).toMatchIndented(`
      INSERT INTO "widgetTable" ("widgetId")
      VALUES
        (1)
    `)
    expect(formatSQL('select widgetId as TABLE from widgetTable')).toMatchIndented(`
      SELECT "widgetId" AS "table"
      FROM "widgetTable"
    `)
  })

  test('preserves quoted ON CONFLICT index identifiers', () => {
    expect(formatSQL(`
      insert into "Memberships" ("campaignId", "userId") values ($1, $2)
      on conflict ("campaignId", "userId") do update set "updatedAt" = now()
    `)).toMatchIndented(`
      INSERT INTO "Memberships" ("campaignId", "userId")
      VALUES
        ($1, $2)
      ON CONFLICT ("campaignId", "userId") DO UPDATE SET "updatedAt" = NOW()
    `)
  })

  test('preserves ON CONFLICT ON CONSTRAINT targets', () => {
    expect(formatSQL(`
      insert into "Memberships" ("campaignId", "userId") values ($1, $2)
      on conflict on constraint "Memberships_pkey" do nothing
    `)).toMatchIndented(`
      INSERT INTO "Memberships" ("campaignId", "userId")
      VALUES
        ($1, $2)
      ON CONFLICT ON CONSTRAINT "Memberships_pkey" DO NOTHING
    `)
  })

  test('formats DISTINCT ON, USING joins, and array expressions', () => {
    expect(formatSQL('select distinct on (a) a, b from t order by a, b')).toMatchIndented(`
      SELECT DISTINCT ON ("a") "a", "b"
      FROM "t"
      ORDER BY "a", "b"
    `)
    expect(formatSQL('select * from t join u using (id)')).toMatchIndented(`
      SELECT *
      FROM "t"
      JOIN "u" USING ("id")
    `)
    expect(formatSQL('select * from t natural join u')).toMatchIndented(`
      SELECT *
      FROM "t"
      NATURAL JOIN "u"
    `)
    expect(formatSQL('select array[1, 2], row(1, 2), data->>\'x\' from t')).toMatchIndented(`
      SELECT ARRAY [1, 2], ROW(1, 2), "data" ->> 'x'
      FROM "t"
    `)
  })

  test('formats window definitions and references', () => {
    expect(formatSQL('select sum(x) over (partition by y order by z) from t')).toMatchIndented(`
      SELECT SUM("x") OVER (PARTITION BY "y" ORDER BY "z")
      FROM "t"
    `)
    expect(formatSQL('select sum(x) over w from t window w as (partition by y)')).toMatchIndented(`
      SELECT SUM("x") OVER "w"
      FROM "t"
      WINDOW "w" AS (PARTITION BY "y")
    `)
  })

  test('formats unique index predicates and null distinctness', () => {
    expect(formatSQL('create unique index idx on t using btree (id) where id is not null')).toMatchIndented(`
      CREATE UNIQUE INDEX "idx" ON "t" USING btree("id") WHERE "id" IS NOT NULL
    `)
    expect(formatSQL('create unique index idx on t (id) nulls not distinct')).toMatchIndented(`
      CREATE UNIQUE INDEX "idx" ON "t" USING btree("id") NULLS NOT DISTINCT
    `)
  })

  test('keeps fallback clauses intact', () => {
    expect(formatSQL('select distinct id from widgets')).toMatchIndented(`
      SELECT DISTINCT "id"
      FROM "widgets"
    `)
    expect(formatSQL('select * from public.widgets')).toMatchIndented(`
      SELECT *
      FROM "public"."widgets"
    `)
  })
})
