import { describe, expect, test } from 'bun:test'
import { Operator } from './Operator'
import { QueryLexer, TokenType } from './QueryLexer'

describe('QueryLexer', () => {
  test('tokenizes fields, operators, strings, and numbers with source spans', () => {
    const source = 'owner.name $eq "Troy" $and owner.age $gt 35'
    const result = QueryLexer.tokenize(source)

    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(token => token.type)).toEqual([
      TokenType.Field,
      TokenType.Operator,
      TokenType.String,
      TokenType.Operator,
      TokenType.Field,
      TokenType.Operator,
      TokenType.Number,
      TokenType.EOF,
    ])
    expect(result.tokens.slice(0, -1).map(token => token.raw)).toEqual([
      'owner.name',
      '$eq',
      '"Troy"',
      '$and',
      'owner.age',
      '$gt',
      '35',
    ])
    expect(result.tokens.slice(0, -1).map(token => [token.start, token.end])).toEqual([
      [0, 10],
      [11, 14],
      [15, 21],
      [22, 26],
      [27, 36],
      [37, 40],
      [41, 43],
    ])
    expect(result.tokens[1]?.operator).toBe(Operator.Comparison.Equal)
    expect(result.tokens[3]?.operator).toBe(Operator.Logical.And)
    expect(result.tokens[5]?.operator).toBe(Operator.Comparison.GreaterThan)
    expect(result.tokens[2]?.value).toBe('Troy')
  })

  test('tokenizes every supported operator identity', () => {
    const source = [...Object.values(Operator.Comparison), ...Object.values(Operator.Logical)].join(' ')
    const result = QueryLexer.tokenize(source)

    expect(result.diagnostics).toEqual([])
    expect(result.tokens.slice(0, -1).map(token => token.operator)).toEqual([
      ...Object.values(Operator.Comparison),
      ...Object.values(Operator.Logical),
    ])
  })

  test('maps symbolic comparisons to the same canonical operator identities', () => {
    const dollar = QueryLexer.tokenize('score $gte 5 $and score $lt 10')
    const symbolic = QueryLexer.tokenize('score >= 5 $and score < 10')

    expect(symbolic.diagnostics).toEqual([])
    expect(symbolic.tokens.map(token => token.operator)).toEqual(dollar.tokens.map(token => token.operator))
    expect(symbolic.tokens[1]?.raw).toBe('>=')
    expect(symbolic.tokens[5]?.raw).toBe('<')
    expect(symbolic.tokens[1]?.operator).toBe(Operator.Comparison.GreaterThanOrEqual)
    expect(symbolic.tokens[5]?.operator).toBe(Operator.Comparison.LessThan)
  })

  test('tokenizes every symbolic comparison alias', () => {
    const result = QueryLexer.tokenize('= > >= < <=')

    expect(result.diagnostics).toEqual([])
    expect(result.tokens.slice(0, -1).map(token => [token.raw, token.operator])).toEqual([
      ['=', Operator.Comparison.Equal],
      ['>', Operator.Comparison.GreaterThan],
      ['>=', Operator.Comparison.GreaterThanOrEqual],
      ['<', Operator.Comparison.LessThan],
      ['<=', Operator.Comparison.LessThanOrEqual],
    ])
  })

  test('reports unsupported symbolic and dollar operators without splitting them', () => {
    const result = QueryLexer.tokenize('!= == $between $or')

    expect(result.tokens.map(token => [token.type, token.raw])).toEqual([
      [TokenType.Unknown, '!='],
      [TokenType.Unknown, '=='],
      [TokenType.Unknown, '$between'],
      [TokenType.Unknown, '$or'],
      [TokenType.EOF, ''],
    ])
    expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      'Unsupported operator "!="',
      'Unsupported operator "=="',
      'Unknown operator "$between"',
      'Unknown operator "$or"',
    ])
  })

  test('tokenizes booleans, null, signed numbers, decimals, and exponents', () => {
    const result = QueryLexer.tokenize('true false null -3 1.5 2e3 -4.5E-2')

    expect(result.diagnostics).toEqual([])
    expect(result.tokens.slice(0, -1).map(token => [token.type, token.value])).toEqual([
      [TokenType.Boolean, true],
      [TokenType.Boolean, false],
      [TokenType.Null, null],
      [TokenType.Number, '-3'],
      [TokenType.Number, '1.5'],
      [TokenType.Number, '2e3'],
      [TokenType.Number, '-4.5E-2'],
    ])
  })

  test('decodes single and double quoted strings and escapes', () => {
    const result = QueryLexer.tokenize('\'one\\nline\' "two\\tlines" "quote\\"d"')

    expect(result.diagnostics).toEqual([])
    expect(result.tokens.slice(0, -1).map(token => token.value)).toEqual([
      'one\nline',
      'two\tlines',
      'quote"d',
    ])
  })

  test('reports unknown operators and characters while recovering', () => {
    const result = QueryLexer.tokenize('score $between 1 @ 2')

    expect(result.tokens.map(token => token.type)).toEqual([
      TokenType.Field,
      TokenType.Unknown,
      TokenType.Number,
      TokenType.Unknown,
      TokenType.Number,
      TokenType.EOF,
    ])
    expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      'Unknown operator "$between"',
      'Unexpected character "@"',
    ])
  })

  test('consumes malformed numeric candidates as one diagnostic token', () => {
    for (const candidate of ['1e', '1e+', '1.', '01']) {
      const result = QueryLexer.tokenize(candidate)
      expect(result.tokens.map(token => [token.type, token.raw])).toEqual([
        [TokenType.Unknown, candidate],
        [TokenType.EOF, ''],
      ])
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({ end: candidate.length, start: 0 })
      expect(result.diagnostics[0]?.message).toBe(`Invalid number literal ${JSON.stringify(candidate)}`)
    }

    const valid = QueryLexer.tokenize('1e+2 -4.5E-2')
    expect(valid.diagnostics).toEqual([])
    expect(valid.tokens.slice(0, -1).map(token => [token.type, token.value])).toEqual([
      [TokenType.Number, '1e+2'],
      [TokenType.Number, '-4.5E-2'],
    ])
  })

  test('reports unterminated strings and malformed numbers', () => {
    const stringResult = QueryLexer.tokenize('"unterminated')
    expect(stringResult.diagnostics[0]?.message).toBe('Unterminated string literal')
    expect(stringResult.tokens[0]).toMatchObject({ type: TokenType.String, value: 'unterminated' })

    const numberResult = QueryLexer.tokenize('-abc')
    expect(numberResult.diagnostics[0]?.message).toBe('Invalid number literal "-"')
    expect(numberResult.tokens[0]?.type).toBe(TokenType.Unknown)
  })

  test('reports malformed field paths', () => {
    const result = QueryLexer.tokenize('owner..name')
    expect(result.diagnostics.map(diagnostic => diagnostic.message)).toContain('Expected a field name after "."')
  })

  test('returns an EOF token for empty input', () => {
    expect(QueryLexer.tokenize('')).toEqual({
      diagnostics: [],
      tokens: [{ end: 0, raw: '', start: 0, type: TokenType.EOF, value: null }],
    })
  })

  test('preserves raw source for every non-EOF token', () => {
    const source = 'score $gte 3 $and title "Hello\\nworld"'
    const result = QueryLexer.tokenize(source)
    for (const token of result.tokens.slice(0, -1)) {
      expect(source.slice(token.start, token.end)).toBe(token.raw)
    }
  })
})
