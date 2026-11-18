/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { formatSQL } from './format'
import { plSemanticTree, verifyPlSemantics, verifySqlSemantics } from './verify'

const FUNCTION = `
create or replace function set_status() returns trigger as $$
declare message text;
begin
  if new.status is null then new.status = 'pending';
  elsif new.status = '' then new.status := 'pending';
  else new.status = lower(new.status);
  end if;
  return new;
exception
  when others then raise notice 'failed'; return null;
end $$ language plpgsql;
`

describe('PL/pgSQL formatting', () => {
  test('formats declarations, IF/ELSIF/ELSE, assignments, RETURN, and EXCEPTION', () => {
    const result = formatSQL(FUNCTION)
    expect(result.status).toBe('formatted')
    if (result.status !== 'formatted') return
    expect(result.sql).toMatchIndented(`
      CREATE OR REPLACE FUNCTION set_status() RETURNS TRIGGER AS $$
      DECLARE
        message TEXT;
      BEGIN
        IF new.status IS NULL THEN
          new.status = 'pending';
        ELSIF new.status = '' THEN
          new.status := 'pending';
        ELSE
          new.status = lower(new.status);
        END IF;

        RETURN NEW;
      EXCEPTION
        WHEN others THEN
          RAISE NOTICE 'failed';
          RETURN null;
      END
      $$ LANGUAGE plpgsql
    `)
  })

  test('preserves PL/pgSQL meaning', () => {
    const result = formatSQL(FUNCTION)
    expect(result.status).toBe('formatted')
    if (result.status !== 'formatted') return
    expect(plSemanticTree(result.sql)).toEqual(plSemanticTree(FUNCTION))
  })

  test('formats a DO block and its comments', () => {
    const result = formatSQL(`
      do $$ begin
        if exists (select 1 from widgets where active = true) then
          -- disable
          update widgets set active = false;
        end if;
      end $$
    `)
    expect(result.status).toBe('formatted')
    if (result.status !== 'formatted') return
    expect(result.sql).toMatchIndented(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM widgets
          WHERE active = true
        ) THEN
          -- disable
          UPDATE widgets
          SET active = false;
        END IF;
      END
      $$
    `)
  })

  test('formats loops, CASE statements, and dynamic SQL', () => {
    const result = formatSQL(`
      create function f() returns int as $$ begin
        for i in 1..10 loop continue when i=2; exit when i=5; end loop;
        case x when 1 then return 1; else return 2; end case;
      end $$ language plpgsql
    `)
    expect(result.status).toBe('formatted')
    if (result.status !== 'formatted') return
    expect(result.sql).toContain('FOR i IN 1..10 LOOP')
    expect(result.sql).toContain('CONTINUE WHEN i = 2;')
    expect(result.sql).toContain('CASE x')
    expect(result.sql).toContain('WHEN 1 THEN')
    expect(result.sql).toContain('END CASE;')
  })

  test('rejects an unsupported PL/pgSQL construct', () => {
    const result = formatSQL(`
      create function f() returns void as $$
      declare c refcursor;
      begin
        open c for select 1;
      end $$ language plpgsql
    `)
    expect(result).toEqual({ construct: 'PLpgSQL_stmt_open', status: 'unsupported' })
  })
})

describe('PL/pgSQL negative controls', () => {
  test('detects a literal change', () => {
    expect(() => verifyPlSemantics(FUNCTION, FUNCTION.replace("'pending'", "'done'"))).toThrow()
  })

  test('detects an operator change', () => {
    expect(() => verifyPlSemantics(FUNCTION, FUNCTION.replace('new.status is null', 'new.status is not null'))).toThrow()
  })

  test('detects a condition change', () => {
    expect(() => verifyPlSemantics(FUNCTION, FUNCTION.replace("new.status = ''", "new.status = 'x'"))).toThrow()
  })

  test('detects an assignment change', () => {
    expect(() => verifyPlSemantics(FUNCTION, FUNCTION.replace('new.status = lower(new.status)', 'new.status = upper(new.status)'))).toThrow()
  })

  test('detects a return expression change', () => {
    expect(() => verifyPlSemantics(FUNCTION, FUNCTION.replace('return new;', 'return old;'))).toThrow()
  })

  test('detects a function attribute change', () => {
    expect(() => verifySqlSemantics(FUNCTION, FUNCTION.replace('language plpgsql', 'language plpgsql volatile'))).toThrow()
  })
})
