import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Predicate } from './Predicate'
import { Predicate as Normalizer, PredicateKind } from './Predicate'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [{
    fields: [
      { name: 'id', primaryKey: true, type: 'uuid' },
      { name: 'active', type: 'boolean' },
      { name: 'createdAt', type: 'timestamp' },
      { name: 'score', type: 'number' },
      { name: 'title', type: 'string' },
    ],
    name: 'Note',
  }],
}))

const entity = definitions.entity('Note')
if (!entity) throw new Error('missing Note entity')

/**
 * Normalize a where expression for the test entity.
 * @param where - Expression to normalize.
 * @returns The normalized predicate.
 */
function normalize(where: Readonly<Record<string, unknown>>): Predicate | null {
  return Normalizer.normalize(entity, where)
}

/**
 * Require a logical predicate.
 * @param predicate - Predicate candidate.
 * @returns The logical predicate.
 */
function logical(predicate: Predicate | null): Extract<Predicate, { kind: PredicateKind.Logical }> {
  if (predicate?.kind !== PredicateKind.Logical) throw new Error('expected logical predicate')
  return predicate
}

describe('Predicate.normalize', () => {
  test('turns scalar shorthand into an equal comparison', () => {
    expect(normalize({ score: 5 })).toMatchObject({
      field: { name: 'score' },
      kind: PredicateKind.Comparison,
      operator: Operator.Comparison.Equal,
      value: 5,
    })
  })

  test('turns multiple field operators into an ordered And node', () => {
    const predicate = logical(normalize({
      score: {
        [Operator.Comparison.GreaterThanOrEqual]: 5,
        [Operator.Comparison.LessThan]: 10,
      },
    }))

    expect(predicate.operator).toBe(Operator.Logical.And)
    expect(predicate.operands).toHaveLength(2)
    expect(predicate.operands.map(operand => (
      operand.kind === PredicateKind.Comparison ? operand.operator : null
    ))).toEqual([Operator.Comparison.GreaterThanOrEqual, Operator.Comparison.LessThan])
  })

  test('combines sibling fields and explicit And while preserving nesting', () => {
    const predicate = logical(normalize({
      active: true,
      [Operator.Logical.And]: [
        { score: { [Operator.Comparison.GreaterThan]: 2 } },
        { title: 'Hello' },
      ],
    }))

    expect(predicate.operator).toBe(Operator.Logical.And)
    expect(predicate.operands).toHaveLength(2)
    expect(predicate.operands[0]).toMatchObject({ field: { name: 'active' }, kind: PredicateKind.Comparison })
    expect(predicate.operands[1]?.kind).toBe(PredicateKind.Logical)
    expect(logical(predicate.operands[1] as Predicate).operands).toHaveLength(2)
  })

  test('preserves nested explicit And groups', () => {
    const predicate = logical(normalize({
      [Operator.Logical.And]: [
        { [Operator.Logical.And]: [{ score: 1 }, { title: 'nested' }] },
        { active: true },
      ],
    }))

    expect(predicate.operands[0]?.kind).toBe(PredicateKind.Logical)
    expect(logical(predicate.operands[0] as Predicate).operands).toHaveLength(2)
  })

  test('uses null equality without an operator object', () => {
    expect(normalize({ score: null })).toMatchObject({
      field: { name: 'score' },
      kind: PredicateKind.Comparison,
      operator: Operator.Comparison.Equal,
      value: null,
    })
  })

  test('treats Date values as scalar operands', () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z')
    expect(normalize({ createdAt })).toMatchObject({
      kind: PredicateKind.Comparison,
      operator: Operator.Comparison.Equal,
      value: createdAt,
    })
  })

  test('returns null for an empty where expression', () => {
    expect(normalize({})).toBeNull()
  })

  test('rejects unknown fields and operators', () => {
    expect(() => normalize({ missing: 1 })).toThrow('Unknown field "Note.missing"')
    expect(() => normalize({ score: { $between: [1, 2] } })).toThrow('Query operator "$between" is not supported')
  })

  test('rejects empty comparison objects and empty logical operands', () => {
    expect(() => normalize({ score: {} })).toThrow('Query condition "Note.score" must include an operator')
    expect(() => normalize({ [Operator.Logical.And]: [] })).toThrow('Query $and must be a non-empty array')
    expect(() => normalize({ [Operator.Logical.And]: [{}] })).toThrow('Query $and operands must be non-empty objects')
  })
})
