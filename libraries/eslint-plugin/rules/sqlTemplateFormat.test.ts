import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
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

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- declaration merging requires the generic slot.
  interface Matchers<T> {
    toMatchSql(expected: string): void,
  }

  interface AsymmetricMatchers {
    toMatchSql(expected: string): void,
  }
}

/**
 * Normalize only the common baseline indentation of a test template.
 * @param value - Template string.
 * @returns Lines with the baseline indentation removed.
 */
function sqlLines(value: unknown): string[] {
  if (typeof value !== 'string') throw new Error('toMatchSql expects a string')
  const lines = value.replace(/\r\n/gu, '\n').split('\n')
  while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()
  const first = lines.find(line => line.trim() !== '')
  const baseline = first?.match(/^\s*/u)?.[0] ?? ''
  return lines.map(line => {
    if (line.trim() === '') return ''
    if (!line.startsWith(baseline)) throw new Error(`SQL line is less indented than the baseline:\n${line}`)
    return line.slice(baseline.length).replace(/\s+$/u, '')
  })
}

/**
 * Assert complete SQL text after normalizing the template baseline indentation.
 * @param this - Matcher context.
 * @param actual - Actual SQL.
 * @param expected - Expected SQL.
 * @returns Match result with a readable failure message.
 */
function toMatchSql(this: unknown, actual: unknown, expected: unknown): { message: () => string, pass: boolean } {
  const received = sqlLines(actual)
  const wanted = sqlLines(expected)
  const pass = received.length === wanted.length
    && received.every((line, index) => line === wanted[index])
  return {
    message: () => `
Expected SQL:
${wanted.join('\n')}
Received SQL:
${received.join('\n')}
    `.trim(),
    pass,
  }
}

expect.extend({ toMatchSql })

describe('formatSQL', () => {
  describe('statements', () => {
    test('omits a single trailing semicolon', () => {
      expect(formatSQL('select 1;')).toMatchSql('SELECT 1')
    })

    test('keeps semicolons and separates multiple statements', () => {
      expect(formatSQL('select 1; select 2')).toMatchSql(`
        SELECT 1;

        SELECT 2
      `)
    })
  })

  describe('select', () => {
    test('formats clauses and indents AND/OR', () => {
      expect(formatSQL(`
        select id, name, created_at from widgets where active = true and owner_id = $1 order by name
      `)).toMatchSql(`
        SELECT id, name, created_at
        FROM widgets
        WHERE active = true
          AND owner_id = $1
        ORDER BY name
      `)
    })
  })

  describe('create view', () => {
    test('wraps the query body in indented parentheses', () => {
      expect(formatSQL(`
        create view active_widgets as select id, name from widgets where active = true
      `)).toMatchSql(`
        CREATE VIEW active_widgets AS (
          SELECT id, name
          FROM widgets
          WHERE active = true
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
      `)).toMatchSql(`
        WITH RECURSIVE widget_tree AS (
          SELECT id, parent_id
          FROM widgets
          WHERE parent_id IS NULL

          UNION ALL

          SELECT w.id, w.parent_id
          FROM widgets w
          JOIN widget_tree t ON w.parent_id = t.id
        )
        SELECT *
        FROM widget_tree
      `)
    })
  })

  describe('plpgsql', () => {
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
      `)).toMatchSql(`
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
      `)).toMatchSql(`
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
      `)).toMatchSql(`
        SELECT COALESCE(
          ARRAY_LENGTH(
            ARRAY_REMOVE(STRING_TO_ARRAY(TRIM(COALESCE(text, '')), ' '), ''),
            1
          ),
          0
        ) AS word_count
        FROM posts
      `)
    })
  })

  describe('case', () => {
    test('formats a case expression in a select list', () => {
      expect(formatSQL(`
        select id,
          case
            when status = 'a' then 1
            when status = 'b' then 2
            else 0
          end as rank
        from widgets
      `)).toMatchSql(`
        SELECT
          id,
          CASE
            WHEN status = 'a' THEN 1
            WHEN status = 'b' THEN 2
            ELSE 0
          END AS rank
        FROM widgets
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
      `)).toMatchSql(`
        SELECT
          id, -- stable identifier
          name -- display name
        FROM widgets
        -- only active widgets
        WHERE active = true
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

  describe('create table', () => {
    test('puts one column or constraint per line', () => {
      expect(formatSQL(`
        create table if not exists widgets (
          id uuid primary key default gen_random_uuid(),
          name varchar(255) not null,
          owner_id varchar(255) not null references accounts(id),
          unique(owner_id, name)
        )
      `)).toMatchSql(`
        CREATE TABLE IF NOT EXISTS widgets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          owner_id VARCHAR(255) NOT NULL REFERENCES accounts(id),
          UNIQUE(owner_id, name)
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
    expect(templateBody(lineComment.output)).toMatchSql(`
      SELECT 1 -- where false
    `)

    const blockComment = lint('sql`select 1 /* where false */`')
    expect(blockComment.fixed).toBe(true)
    expect(templateBody(blockComment.output)).toMatchSql(`
      SELECT 1 /* where false */
    `)
  })

  test('formats SQL around a dollar-quoted body and preserves the body', () => {
    const output = lint('sql`select $$a\n  b$$`')
    expect(output.fixed).toBe(true)
    expect(templateBody(output.output)).toMatchSql(`
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

  test('accepts canonical multiline SQL', () => {
    const code = 'sql`\n  SELECT 1\n`'
    expect(lint(code).fixed).toBe(false)
  })
})
