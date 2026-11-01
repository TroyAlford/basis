import { describe, expect, test } from 'bun:test'
import { Operator } from './Operator'
import { TokenType } from './QueryLexer'
import type { QueryComparison, QueryExpression, QueryGroup, QueryLiteral, QueryLogical } from './QueryParser'
import { QueryParser } from './QueryParser'

type BareLiteral = Omit<QueryLiteral, 'end' | 'start'>

const number = (raw: string): BareLiteral => ({ kind: 'number', raw, value: raw })
const string = (raw: string, value: string): BareLiteral => ({ kind: 'string', raw, value })
const boolean = (raw: string, value: boolean): BareLiteral => ({ kind: 'boolean', raw, value })
const nullLiteral = (raw = 'null'): BareLiteral => ({ kind: 'null', raw, value: null })

const comparison = (
  field: string,
  operator: Operator.Comparison,
  values: readonly BareLiteral[],
): object => ({ field, kind: 'comparison', operator, values })

const logical = (
  operator: Operator.Logical,
  filters: readonly QueryExpression[],
): object => ({ filters, kind: 'logical', operator })

const group = (expression: QueryExpression): object => ({ expression, kind: 'group' })

/**
 * Remove source offsets for semantic comparisons.
 * @param value - Syntax value to copy.
 * @returns The same value without `start` or `end` properties.
 */
function withoutSpans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSpans)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'start' && key !== 'end')
      .map(([key, child]) => [key, withoutSpans(child)]),
  )
}

/**
 * Return the exact source slice covered by a syntax node.
 * @param source - Original query source.
 * @param node - Syntax node with source offsets.
 * @returns The covered source text.
 */
function slice(source: string, node: QueryExpression): string {
  return source.slice(node.start, node.end)
}

describe('QueryParser', () => {
  test('parses comparison aliases into the same transient syntax', () => {
    expect(withoutSpans(QueryParser.parse('score >= 5').expression))
      .toEqual(comparison('score', Operator.Comparison.GreaterThanOrEqual, [number('5')]))
    expect(withoutSpans(QueryParser.parse('score $gte 5').expression))
      .toEqual(withoutSpans(QueryParser.parse('score >= 5').expression))
    expect(withoutSpans(QueryParser.parse('title = "Hello"').expression))
      .toEqual(comparison('title', Operator.Comparison.Equal, [string('"Hello"', 'Hello')]))
  })

  test('preserves source comparison operators without executing them', () => {
    const expected = comparison('score', Operator.Comparison.NotEqual, [number('5')])
    expect(withoutSpans(QueryParser.parse('score $ne 5').expression)).toEqual(expected)
    expect(withoutSpans(QueryParser.parse('score != 5').expression)).toEqual(expected)
    expect(withoutSpans(QueryParser.parse('score <> 5').expression)).toEqual(expected)

    expect(withoutSpans(QueryParser.parse('score $between [1, 5]').expression)).toEqual(
      comparison('score', Operator.Comparison.Between, [number('1'), number('5')]),
    )
    expect(withoutSpans(QueryParser.parse('score $between [1, null]').expression)).toEqual(
      comparison('score', Operator.Comparison.Between, [number('1'), nullLiteral()]),
    )
    expect(withoutSpans(QueryParser.parse('score $between [null, 5]').expression)).toEqual(
      comparison('score', Operator.Comparison.Between, [nullLiteral(), number('5')]),
    )
    expect(withoutSpans(QueryParser.parse('title $empty').expression))
      .toEqual(comparison('title', Operator.Comparison.Empty, []))
  })

  test('supports postfix and prefix Not', () => {
    const empty = comparison('title', Operator.Comparison.Empty, [])
    expect(withoutSpans(QueryParser.parse('title !$empty').expression))
      .toEqual(logical(Operator.Logical.Not, [empty as QueryExpression]))
    expect(withoutSpans(QueryParser.parse('title $not $empty').expression))
      .toEqual(withoutSpans(QueryParser.parse('title !$empty').expression))
    expect(withoutSpans(QueryParser.parse('$not score > 5').expression)).toEqual(logical(
      Operator.Logical.Not,
      [comparison('score', Operator.Comparison.GreaterThan, [number('5')]) as QueryExpression],
    ))
  })

  test('combines And and Or expressions with conventional precedence', () => {
    expect(withoutSpans(QueryParser.parse('score > 1 $and score < 5').expression)).toEqual(logical(
      Operator.Logical.And,
      [
        comparison('score', Operator.Comparison.GreaterThan, [number('1')]) as QueryExpression,
        comparison('score', Operator.Comparison.LessThan, [number('5')]) as QueryExpression,
      ],
    ))
    expect(withoutSpans(QueryParser.parse('score = 1 $or score = 2 $and active = true').expression))
      .toEqual(logical(Operator.Logical.Or, [
        comparison('score', Operator.Comparison.Equal, [number('1')]) as QueryExpression,
        logical(Operator.Logical.And, [
          comparison('score', Operator.Comparison.Equal, [number('2')]) as QueryExpression,
          comparison('active', Operator.Comparison.Equal, [boolean('true', true)]) as QueryExpression,
        ]) as QueryExpression,
      ]))
  })

  test('honors grouping parentheses around And and Or expressions', () => {
    expect(withoutSpans(QueryParser.parse('(score = 1 $or score = 2) $and active = true').expression))
      .toEqual(logical(Operator.Logical.And, [
        group(logical(Operator.Logical.Or, [
          comparison('score', Operator.Comparison.Equal, [number('1')]) as QueryExpression,
          comparison('score', Operator.Comparison.Equal, [number('2')]) as QueryExpression,
        ]) as QueryExpression) as QueryExpression,
        comparison('active', Operator.Comparison.Equal, [boolean('true', true)]) as QueryExpression,
      ]))
    expect(withoutSpans(QueryParser.parse('$not (score = 1 $or score = 2)').expression))
      .toEqual(logical(Operator.Logical.Not, [
        group(logical(Operator.Logical.Or, [
          comparison('score', Operator.Comparison.Equal, [number('1')]) as QueryExpression,
          comparison('score', Operator.Comparison.Equal, [number('2')]) as QueryExpression,
        ]) as QueryExpression) as QueryExpression,
      ]))
  })

  test('preserves literal kind, raw spelling, and dotted field names', () => {
    const source = 'owner.Score = "x\\ny" $and active = false $and missing = null ' +
      '$and max = 9223372036854775807 $and ratio = 1.5 $and quoted = "5"'
    expect(withoutSpans(QueryParser.parse(source).expression))
      .toEqual(logical(Operator.Logical.And, [
        comparison('owner.Score', Operator.Comparison.Equal, [string('"x\\ny"', 'x\ny')]) as QueryExpression,
        comparison('active', Operator.Comparison.Equal, [boolean('false', false)]) as QueryExpression,
        comparison('missing', Operator.Comparison.Equal, [nullLiteral()]) as QueryExpression,
        comparison('max', Operator.Comparison.Equal, [number('9223372036854775807')]) as QueryExpression,
        comparison('ratio', Operator.Comparison.Equal, [number('1.5')]) as QueryExpression,
        comparison('quoted', Operator.Comparison.Equal, [string('"5"', '5')]) as QueryExpression,
      ]))
  })

  test('does not coerce numeric spellings or reject lexically valid numbers', () => {
    expect(withoutSpans(QueryParser.parse('score = 1e999').expression))
      .toEqual(comparison('score', Operator.Comparison.Equal, [number('1e999')]))
  })

  test('attaches distinct source ranges to repeated identical predicates', () => {
    const source = 'score = 1 $or score = 1'
    const expression = QueryParser.parse(source).expression as QueryLogical
    expect(expression.kind).toBe('logical')
    expect(expression.operator).toBe(Operator.Logical.Or)
    expect(slice(source, expression)).toBe(source)
    expect(expression.filters.map(filter => slice(source, filter)))
      .toEqual(['score = 1', 'score = 1'])
    expect(expression.filters[0]?.start).not.toBe(expression.filters[1]?.start)
  })

  test('includes grouping delimiters in nested group ranges', () => {
    const source = '(score = 1 $or (score = 2 $and active = true))'
    const outer = QueryParser.parse(source).expression as QueryGroup
    expect(outer.kind).toBe('group')
    expect(slice(source, outer)).toBe(source)
    const grouped = outer.expression as QueryLogical
    expect(grouped.kind).toBe('logical')
    expect(slice(source, grouped)).toBe('score = 1 $or (score = 2 $and active = true)')
    const inner = grouped.filters[1] as QueryGroup
    expect(inner.kind).toBe('group')
    expect(slice(source, inner)).toBe('(score = 2 $and active = true)')
  })

  test('covers the full negated expression in Not ranges', () => {
    const prefixSource = '$not (score = 1 $or score = 2)'
    const prefix = QueryParser.parse(prefixSource).expression as QueryLogical
    expect(prefix.operator).toBe(Operator.Logical.Not)
    expect(slice(prefixSource, prefix)).toBe(prefixSource)
    const groupNode = prefix.filters[0] as QueryGroup
    expect(slice(prefixSource, groupNode)).toBe('(score = 1 $or score = 2)')

    const postfixSource = 'title !$empty'
    const postfix = QueryParser.parse(postfixSource).expression as QueryLogical
    expect(postfix.operator).toBe(Operator.Logical.Not)
    expect(slice(postfixSource, postfix)).toBe(postfixSource)
  })

  test('covers the comparison and both bounds in Between ranges', () => {
    const source = 'score $between [1, 5]'
    const expression = QueryParser.parse(source).expression as QueryComparison
    expect(expression.kind).toBe('comparison')
    expect(slice(source, expression)).toBe(source)
    expect(expression.values.map(value => source.slice(value.start, value.end)))
      .toEqual(['1', '5'])
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
