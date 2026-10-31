import { describe, expect, test } from 'bun:test'
import { Operator } from './Operator'
import { TokenType } from './QueryLexer'
import { QueryParser } from './QueryParser'

describe('QueryParser', () => {
  test('parses comparison aliases into the same canonical filter', () => {
    expect(QueryParser.parse('score >= 5').filter).toEqual({
      field: 'score',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 5n,
    })
    expect(QueryParser.parse('score $gte 5').filter).toEqual(QueryParser.parse('score >= 5').filter)
    expect(QueryParser.parse('title = "Hello"').filter).toEqual({
      field: 'title',
      operator: Operator.Comparison.Equal,
      value: 'Hello',
    })
  })

  test('expands NotEqual into Not(Equal)', () => {
    const expected = {
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5n }],
      operator: Operator.Logical.Not,
    }
    expect(QueryParser.parse('score $ne 5').filter).toEqual(expected)
    expect(QueryParser.parse('score != 5').filter).toEqual(expected)
    expect(QueryParser.parse('score <> 5').filter).toEqual(expected)
  })

  test('expands Between into an inclusive And range', () => {
    expect(QueryParser.parse('score $between [1, 5]').filter).toEqual({
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 1n },
        { field: 'score', operator: Operator.Comparison.LessThanOrEqual, value: 5n },
      ],
      operator: Operator.Logical.And,
    })
    expect(QueryParser.parse('score $between [1, null]').filter).toEqual({
      field: 'score',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 1n,
    })
    expect(QueryParser.parse('score $between [null, 5]').filter).toEqual({
      field: 'score',
      operator: Operator.Comparison.LessThanOrEqual,
      value: 5n,
    })
  })

  test('expands Empty and supports postfix and prefix Not', () => {
    const empty = {
      filters: [
        { field: 'title', operator: Operator.Comparison.Equal, value: null },
        { field: 'title', operator: Operator.Comparison.Equal, value: '' },
      ],
      operator: Operator.Logical.Or,
    }
    expect(QueryParser.parse('title $empty').filter).toEqual(empty)
    expect(QueryParser.parse('title !$empty').filter).toEqual({
      filters: [empty],
      operator: Operator.Logical.Not,
    })
    expect(QueryParser.parse('title $not $empty').filter).toEqual(QueryParser.parse('title !$empty').filter)
    expect(QueryParser.parse('$not score > 5').filter).toEqual({
      filters: [{ field: 'score', operator: Operator.Comparison.GreaterThan, value: 5n }],
      operator: Operator.Logical.Not,
    })
  })

  test('combines And and Or expressions with conventional precedence', () => {
    expect(QueryParser.parse('score > 1 $and score < 5').filter).toEqual({
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThan, value: 1n },
        { field: 'score', operator: Operator.Comparison.LessThan, value: 5n },
      ],
      operator: Operator.Logical.And,
    })
    expect(QueryParser.parse('score = 1 $or score = 2 $and active = true').filter).toEqual({
      filters: [
        { field: 'score', operator: Operator.Comparison.Equal, value: 1n },
        {
          filters: [
            { field: 'score', operator: Operator.Comparison.Equal, value: 2n },
            { field: 'active', operator: Operator.Comparison.Equal, value: true },
          ],
          operator: Operator.Logical.And,
        },
      ],
      operator: Operator.Logical.Or,
    })
  })

  test('honors grouping parentheses around And and Or expressions', () => {
    expect(QueryParser.parse('(score = 1 $or score = 2) $and active = true').filter).toEqual({
      filters: [
        {
          filters: [
            { field: 'score', operator: Operator.Comparison.Equal, value: 1n },
            { field: 'score', operator: Operator.Comparison.Equal, value: 2n },
          ],
          operator: Operator.Logical.Or,
        },
        { field: 'active', operator: Operator.Comparison.Equal, value: true },
      ],
      operator: Operator.Logical.And,
    })
    expect(QueryParser.parse('$not (score = 1 $or score = 2)').filter).toEqual({
      filters: [{
        filters: [
          { field: 'score', operator: Operator.Comparison.Equal, value: 1n },
          { field: 'score', operator: Operator.Comparison.Equal, value: 2n },
        ],
        operator: Operator.Logical.Or,
      }],
      operator: Operator.Logical.Not,
    })
  })

  test('preserves literal kinds, exact integers, dotted fields, and escapes', () => {
    const source = 'owner.Score = "x\\ny" $and active = false $and missing = null ' +
      '$and max = 9223372036854775807 $and ratio = 1.5 $and quoted = "5"'
    expect(QueryParser.parse(source).filter)
      .toEqual({
        filters: [
          { field: 'owner.Score', operator: Operator.Comparison.Equal, value: 'x\ny' },
          { field: 'active', operator: Operator.Comparison.Equal, value: false },
          { field: 'missing', operator: Operator.Comparison.Equal, value: null },
          { field: 'max', operator: Operator.Comparison.Equal, value: 9223372036854775807n },
          { field: 'ratio', operator: Operator.Comparison.Equal, value: 1.5 },
          { field: 'quoted', operator: Operator.Comparison.Equal, value: '5' },
        ],
        operator: Operator.Logical.And,
      })
  })

  test('returns useful diagnostics for incomplete input', () => {
    expect(QueryParser.parse('score >')).toMatchObject({
      diagnostics: [{ end: 7, message: 'Expected a literal value', start: 7 }],
      filter: null,
    })
    expect(QueryParser.parse('score')).toMatchObject({
      diagnostics: [{ end: 5, message: 'Expected an operator after field', start: 5 }],
      filter: null,
    })
    expect(QueryParser.parse('score > 5 $and')).toMatchObject({
      diagnostics: [{ end: 14, message: 'Expected a field name', start: 14 }],
      filter: null,
    })
    expect(QueryParser.parse('score $between [1, 5')).toMatchObject({
      diagnostics: [{ end: 20, message: 'Expected "]" after range bounds', start: 20 }],
      filter: null,
    })
    expect(QueryParser.parse('(score = 1')).toMatchObject({
      diagnostics: [{ end: 10, message: 'Expected ")" after grouped expression', start: 10 }],
      filter: null,
    })
    expect(QueryParser.parse('score = 1e999')).toMatchObject({
      diagnostics: [{ end: 13, message: 'Number literal is out of range', start: 8 }],
      filter: null,
    })
  })

  test('propagates lexer diagnostics and rejects incomplete expressions', () => {
    const result = QueryParser.parse('score @ 5')
    expect(result.filter).toBeNull()
    expect(result.diagnostics).toEqual([
      { end: 7, message: 'Unexpected character "@"', start: 6 },
      { end: 7, message: 'Expected an operator after field', start: 6 },
    ])
  })

  test('rejects both-null Between bounds', () => {
    expect(QueryParser.parse('score $between [null, null]').filter).toBeNull()
    expect(QueryParser.parse('score $between [null, null]').diagnostics[0]?.message)
      .toBe('Between requires at least one non-null bound')
  })

  test('returns null for empty input', () => {
    expect(QueryParser.parse('')).toEqual({
      diagnostics: [],
      filter: null,
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
