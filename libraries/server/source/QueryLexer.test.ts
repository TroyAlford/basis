import { describe, expect, test } from 'bun:test'
import { Operator } from './Operator'
import { QueryLexer, TokenType } from './QueryLexer'

/** One expected non-EOF token. */
interface ExpectedToken {
  readonly operator?: Operator.Comparison | Operator.Logical,
  readonly raw: string,
  readonly type: TokenType,
  readonly value: string | boolean | null,
}

/** One expected diagnostic. */
interface ExpectedDiagnostic {
  readonly message: string,
  readonly raw: string,
  readonly start?: number,
}

/**
 * Assert the complete token stream and diagnostics for one source string.
 * @param source - Lexer input.
 * @param expected - Expected non-EOF tokens.
 * @param diagnostics - Expected diagnostics.
 */
function assertLex(
  source: string,
  expected: readonly ExpectedToken[],
  diagnostics: readonly ExpectedDiagnostic[] = [],
): void {
  const result = QueryLexer.tokenize(source)
  expect(result.tokens).toHaveLength(expected.length + 1)

  let cursor = 0
  for (const [index, token] of expected.entries()) {
    const actual = result.tokens[index]
    const start = source.indexOf(token.raw, cursor)
    expect(start).toBeGreaterThan(-1)
    expect(actual).toMatchObject({
      end: start + token.raw.length,
      raw: token.raw,
      start,
      type: token.type,
      value: token.value,
    })
    if (token.operator === undefined) expect(actual?.operator).toBeUndefined()
    else expect(actual?.operator).toBe(token.operator)
    cursor = start + token.raw.length
  }

  const eof = result.tokens.at(-1)
  expect(eof).toMatchObject({
    end: source.length,
    raw: '',
    start: source.length,
    type: TokenType.EOF,
    value: null,
  })

  let diagnosticCursor = 0
  for (const [index, diagnostic] of diagnostics.entries()) {
    const start = diagnostic.start ?? source.indexOf(diagnostic.raw, diagnosticCursor)
    expect(start).toBeGreaterThan(-1)
    expect(result.diagnostics[index]).toEqual({
      end: start + diagnostic.raw.length,
      message: diagnostic.message,
      start,
    })
    diagnosticCursor = start + diagnostic.raw.length
  }
  expect(result.diagnostics).toHaveLength(diagnostics.length)
}

const field = (raw: string): ExpectedToken => ({ raw, type: TokenType.Field, value: raw })
const number = (raw: string): ExpectedToken => ({ raw, type: TokenType.Number, value: raw })
const string = (raw: string, value: string): ExpectedToken => ({ raw, type: TokenType.String, value })
const operator = (
  raw: string,
  identity: Operator.Comparison | Operator.Logical,
): ExpectedToken => ({ operator: identity, raw, type: TokenType.Operator, value: raw })
const boolean = (raw: string, value: boolean): ExpectedToken => ({ raw, type: TokenType.Boolean, value })
const nullToken: ExpectedToken = { raw: 'null', type: TokenType.Null, value: null }
const leftBracket = (): ExpectedToken => ({ raw: '[', type: TokenType.LeftBracket, value: '[' })
const rightBracket = (): ExpectedToken => ({ raw: ']', type: TokenType.RightBracket, value: ']' })
const comma = (): ExpectedToken => ({ raw: ',', type: TokenType.Comma, value: ',' })
const unknown = (raw: string): ExpectedToken => ({ raw, type: TokenType.Unknown, value: raw })

describe('QueryLexer', () => {
  test('maps all comparison alias pairs to one enum identity', () => {
    const pairs = [
      ['=', Operator.Comparison.Equal, '$eq'],
      ['>', Operator.Comparison.GreaterThan, '$gt'],
      ['>=', Operator.Comparison.GreaterThanOrEqual, '$gte'],
      ['<', Operator.Comparison.LessThan, '$lt'],
      ['<=', Operator.Comparison.LessThanOrEqual, '$lte'],
    ] as const

    for (const [symbol, identity, dollar] of pairs) {
      assertLex(`score ${symbol} 5 $and score ${dollar} 5`, [
        field('score'),
        operator(symbol, identity),
        number('5'),
        operator('$and', Operator.Logical.And),
        field('score'),
        operator(dollar, identity),
        number('5'),
      ])
    }
  })

  test('tokenizes rooted fields with capitalization and underscores preserved', () => {
    assertLex(
      'score owner.score owner.profile.score _metadata.id Score owner.Score Owner.score OWNER.SCORE',
      [
        field('score'),
        field('owner.score'),
        field('owner.profile.score'),
        field('_metadata.id'),
        field('Score'),
        field('owner.Score'),
        field('Owner.score'),
        field('OWNER.SCORE'),
      ],
    )
  })

  test('tokenizes mixed expressions with mixed spellings and whitespace', () => {
    assertLex('score >= 5 $and score $lt 10', [
      field('score'),
      operator('>=', Operator.Comparison.GreaterThanOrEqual),
      number('5'),
      operator('$and', Operator.Logical.And),
      field('score'),
      operator('$lt', Operator.Comparison.LessThan),
      number('10'),
    ])
    assertLex('owner.Score >= 5 $and owner.profile.age < 10', [
      field('owner.Score'),
      operator('>=', Operator.Comparison.GreaterThanOrEqual),
      number('5'),
      operator('$and', Operator.Logical.And),
      field('owner.profile.age'),
      operator('<', Operator.Comparison.LessThan),
      number('10'),
    ])
    assertLex('score\t>=\n5', [
      field('score'),
      operator('>=', Operator.Comparison.GreaterThanOrEqual),
      number('5'),
    ])
    assertLex('score>=5', [
      field('score'),
      operator('>=', Operator.Comparison.GreaterThanOrEqual),
      number('5'),
    ])
  })

  test('preserves literal boundaries, exact integers, and quoted operator text', () => {
    assertLex('title "$and >= $or" active true missing null max 9223372036854775807', [
      field('title'),
      string('"$and >= $or"', '$and >= $or'),
      field('active'),
      boolean('true', true),
      field('missing'),
      nullToken,
      field('max'),
      number('9223372036854775807'),
    ])
    assertLex('\'one\\nline\' "quote\\"d"', [
      string('\'one\\nline\'', 'one\nline'),
      string('"quote\\"d"', 'quote"d'),
    ])
  })

  test('recognizes the extended operator vocabulary and between delimiters', () => {
    assertLex('!= <> $ne $between [1, 5] $empty $or $not', [
      operator('!=', Operator.Comparison.NotEqual),
      operator('<>', Operator.Comparison.NotEqual),
      operator('$ne', Operator.Comparison.NotEqual),
      operator('$between', Operator.Comparison.Between),
      leftBracket(),
      number('1'),
      comma(),
      number('5'),
      rightBracket(),
      operator('$empty', Operator.Comparison.Empty),
      operator('$or', Operator.Logical.Or),
      operator('$not', Operator.Logical.Not),
    ])
  })

  test('distinguishes lexical unary Not from NotEqual aliases', () => {
    assertLex('title !$empty', [
      field('title'),
      operator('!', Operator.Logical.Not),
      operator('$empty', Operator.Comparison.Empty),
    ])
    assertLex('title $not $empty', [
      field('title'),
      operator('$not', Operator.Logical.Not),
      operator('$empty', Operator.Comparison.Empty),
    ])
    for (const source of ['score != 5', 'score <> 5', 'score $ne 5']) {
      assertLex(source, [
        field('score'),
        operator(source.split(' ')[1] as string, Operator.Comparison.NotEqual),
        number('5'),
      ])
    }
  })

  test('reports unsupported operators without splitting them', () => {
    assertLex('score == 5 $blank 1 $notblank 2 $nor 3 $xor 4', [
      field('score'),
      unknown('=='),
      number('5'),
      unknown('$blank'),
      number('1'),
      unknown('$notblank'),
      number('2'),
      unknown('$nor'),
      number('3'),
      unknown('$xor'),
      number('4'),
    ], [
      { message: 'Unsupported operator "=="', raw: '==' },
      { message: 'Unknown operator "$blank"', raw: '$blank' },
      { message: 'Unknown operator "$notblank"', raw: '$notblank' },
      { message: 'Unknown operator "$nor"', raw: '$nor' },
      { message: 'Unknown operator "$xor"', raw: '$xor' },
    ])
  })

  test('keeps operator and keyword matching case-sensitive', () => {
    assertLex('TRUE Null $EQ', [
      field('TRUE'),
      field('Null'),
      unknown('$EQ'),
    ], [
      { message: 'Unknown operator "$EQ"', raw: '$EQ' },
    ])
  })

  test('consumes malformed numeric candidates as one diagnostic token', () => {
    for (const candidate of ['1e', '1e+', '1.', '01']) {
      assertLex(candidate, [unknown(candidate)], [
        { message: `Invalid number literal ${JSON.stringify(candidate)}`, raw: candidate },
      ])
    }

    assertLex('1e+2 -4.5E-2', [number('1e+2'), number('-4.5E-2')])
  })

  test('recovers from malformed paths and continues with following valid tokens', () => {
    assertLex('owner..name score 5', [
      field('owner'),
      unknown('.'),
      unknown('.'),
      field('name'),
      field('score'),
      number('5'),
    ], [
      { message: 'Expected a field name after "."', raw: '.', start: 5 },
      { message: 'Unexpected character "."', raw: '.', start: 5 },
      { message: 'Unexpected character "."', raw: '.', start: 6 },
    ])
  })

  test('reports unterminated strings and unsupported characters', () => {
    assertLex('"unterminated', [string('"unterminated', 'unterminated')], [
      { message: 'Unterminated string literal', raw: '"unterminated' },
    ])
    assertLex('score @ 5', [field('score'), unknown('@'), number('5')], [
      { message: 'Unexpected character "@"', raw: '@' },
    ])
  })

  test('returns an EOF token for empty input', () => {
    assertLex('', [])
  })

  test('preserves raw source spans for every token', () => {
    const source = 'owner.Score >= 5 $and title "$gte $and" $between [1, 3]'
    const result = QueryLexer.tokenize(source)
    for (const token of result.tokens.slice(0, -1)) {
      expect(source.slice(token.start, token.end)).toBe(token.raw)
    }
  })
})
