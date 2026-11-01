import { describe, expect, test } from 'bun:test'
import { Operator } from './Operator'
import { TokenType } from './QueryLexer'
import type { QueryExpression, QueryLiteral } from './QueryParser'
import { QueryParser } from './QueryParser'

const number = (raw: string): QueryLiteral => ({ kind: 'number', raw, value: raw })
const string = (raw: string, value: string): QueryLiteral => ({ kind: 'string', raw, value })
const boolean = (raw: string, value: boolean): QueryLiteral => ({ kind: 'boolean', raw, value })
const nullLiteral = (raw = 'null'): QueryLiteral => ({ kind: 'null', raw, value: null })

const comparison = (
  field: string,
  operator: Operator.Comparison,
  values: readonly QueryLiteral[],
): QueryExpression => ({ field, kind: 'comparison', operator, values })

const logical = (
  operator: Operator.Logical,
  filters: readonly QueryExpression[],
): QueryExpression => ({ filters, kind: 'logical', operator })

describe('QueryParser', () => {
  test('parses comparison aliases into the same transient syntax', () => {
    expect(QueryParser.parse('score >= 5').expression)
      .toEqual(comparison('score', Operator.Comparison.GreaterThanOrEqual, [number('5')]))
    expect(QueryParser.parse('score $gte 5').expression)
      .toEqual(QueryParser.parse('score >= 5').expression)
    expect(QueryParser.parse('title = "Hello"').expression)
      .toEqual(comparison('title', Operator.Comparison.Equal, [string('"Hello"', 'Hello')]))
  })

  test('preserves source comparison operators without executing them', () => {
    const expected = comparison('score', Operator.Comparison.NotEqual, [number('5')])
    expect(QueryParser.parse('score $ne 5').expression).toEqual(expected)
    expect(QueryParser.parse('score != 5').expression).toEqual(expected)
    expect(QueryParser.parse('score <> 5').expression).toEqual(expected)

    expect(QueryParser.parse('score $between [1, 5]').expression).toEqual(
      comparison('score', Operator.Comparison.Between, [number('1'), number('5')]),
    )
    expect(QueryParser.parse('score $between [1, null]').expression).toEqual(
      comparison('score', Operator.Comparison.Between, [number('1'), nullLiteral()]),
    )
    expect(QueryParser.parse('score $between [null, 5]').expression).toEqual(
      comparison('score', Operator.Comparison.Between, [nullLiteral(), number('5')]),
    )
    expect(QueryParser.parse('title $empty').expression)
      .toEqual(comparison('title', Operator.Comparison.Empty, []))
  })

  test('supports postfix and prefix Not', () => {
    const empty = comparison('title', Operator.Comparison.Empty, [])
    expect(QueryParser.parse('title !$empty').expression)
      .toEqual(logical(Operator.Logical.Not, [empty]))
    expect(QueryParser.parse('title $not $empty').expression)
      .toEqual(QueryParser.parse('title !$empty').expression)
    expect(QueryParser.parse('$not score > 5').expression).toEqual(logical(Operator.Logical.Not, [
      comparison('score', Operator.Comparison.GreaterThan, [number('5')]),
    ]))
  })

  test('combines And and Or expressions with conventional precedence', () => {
    expect(QueryParser.parse('score > 1 $and score < 5').expression).toEqual(logical(
      Operator.Logical.And,
      [
        comparison('score', Operator.Comparison.GreaterThan, [number('1')]),
        comparison('score', Operator.Comparison.LessThan, [number('5')]),
      ],
    ))
    expect(QueryParser.parse('score = 1 $or score = 2 $and active = true').expression).toEqual(
      logical(Operator.Logical.Or, [
        comparison('score', Operator.Comparison.Equal, [number('1')]),
        logical(Operator.Logical.And, [
          comparison('score', Operator.Comparison.Equal, [number('2')]),
          comparison('active', Operator.Comparison.Equal, [boolean('true', true)]),
        ]),
      ]),
    )
  })

  test('honors grouping parentheses around And and Or expressions', () => {
    expect(QueryParser.parse('(score = 1 $or score = 2) $and active = true').expression).toEqual(
      logical(Operator.Logical.And, [
        logical(Operator.Logical.Or, [
          comparison('score', Operator.Comparison.Equal, [number('1')]),
          comparison('score', Operator.Comparison.Equal, [number('2')]),
        ]),
        comparison('active', Operator.Comparison.Equal, [boolean('true', true)]),
      ]),
    )
    expect(QueryParser.parse('$not (score = 1 $or score = 2)').expression).toEqual(
      logical(Operator.Logical.Not, [
        logical(Operator.Logical.Or, [
          comparison('score', Operator.Comparison.Equal, [number('1')]),
          comparison('score', Operator.Comparison.Equal, [number('2')]),
        ]),
      ]),
    )
  })

  test('preserves literal kind, raw spelling, and dotted field names', () => {
    const source = 'owner.Score = "x\\ny" $and active = false $and missing = null ' +
      '$and max = 9223372036854775807 $and ratio = 1.5 $and quoted = "5"'
    expect(QueryParser.parse(source).expression)
      .toEqual(logical(Operator.Logical.And, [
        comparison('owner.Score', Operator.Comparison.Equal, [string('"x\\ny"', 'x\ny')]),
        comparison('active', Operator.Comparison.Equal, [boolean('false', false)]),
        comparison('missing', Operator.Comparison.Equal, [nullLiteral()]),
        comparison('max', Operator.Comparison.Equal, [number('9223372036854775807')]),
        comparison('ratio', Operator.Comparison.Equal, [number('1.5')]),
        comparison('quoted', Operator.Comparison.Equal, [string('"5"', '5')]),
      ]))
  })

  test('does not coerce numeric spellings or reject lexically valid numbers', () => {
    expect(QueryParser.parse('score = 1e999').expression).toEqual(
      comparison('score', Operator.Comparison.Equal, [number('1e999')]),
    )
  })

  test('returns useful diagnostics for incomplete input', () => {
    expect(QueryParser.parse('score >')).toMatchObject({
      diagnostics: [{ end: 7, message: 'Expected a literal value', start: 7 }],
      expression: null,
    })
    expect(QueryParser.parse('score')).toMatchObject({
      diagnostics: [{ end: 5, message: 'Expected an operator after field', start: 5 }],
      expression: null,
    })
    expect(QueryParser.parse('score > 5 $and')).toMatchObject({
      diagnostics: [{ end: 14, message: 'Expected a field name', start: 14 }],
      expression: null,
    })
    expect(QueryParser.parse('score $between [1, 5')).toMatchObject({
      diagnostics: [{ end: 20, message: 'Expected "]" after range bounds', start: 20 }],
      expression: null,
    })
    expect(QueryParser.parse('(score = 1')).toMatchObject({
      diagnostics: [{ end: 10, message: 'Expected ")" after grouped expression', start: 10 }],
      expression: null,
    })
  })

  test('does not expose an expression when lexing reports an error', () => {
    const result = QueryParser.parse('title = "unterminated')
    expect(result.expression).toBeNull()
    expect(result.diagnostics).toContainEqual({
      end: 21,
      message: 'Unterminated string literal',
      start: 8,
    })
  })

  test('propagates lexer diagnostics and rejects incomplete expressions', () => {
    const result = QueryParser.parse('score @ 5')
    expect(result.expression).toBeNull()
    expect(result.diagnostics).toEqual([
      { end: 7, message: 'Unexpected character "@"', start: 6 },
      { end: 7, message: 'Expected an operator after field', start: 6 },
    ])
  })

  test('rejects both-null Between bounds', () => {
    expect(QueryParser.parse('score $between [null, null]').expression).toBeNull()
    expect(QueryParser.parse('score $between [null, null]').diagnostics[0]?.message)
      .toBe('Between requires at least one non-null bound')
  })

  test('returns null for empty input', () => {
    expect(QueryParser.parse('')).toEqual({
      diagnostics: [],
      expression: null,
      tokens: [{
        end: 0,
        raw: '',
        start: 0,
        type: TokenType.EOF,
        value: null,
      }],
    })
  })
})
