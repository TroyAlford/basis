import { describe, expect, test } from 'bun:test'
import type { EntityDefinition, EntityDefinitions } from './EntityDefinitions'
import { EntityDefinitions as Definitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Predicate } from './Predicate'
import { PredicateEligibility } from './PredicateEligibility'
import { QueryNormalizer } from './QueryNormalizer'

/**
 * Load entity definitions through their canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated definitions.
 */
function load(value: unknown): EntityDefinitions {
  return Definitions.load(JSON.stringify(value))
}

/**
 * Require one named entity.
 * @param definitions - Canonical definitions.
 * @param name - Entity name.
 * @returns The entity definition.
 */
function entity(definitions: EntityDefinitions, name: string): EntityDefinition {
  const definition = definitions.entity(name)
  if (!definition) throw new Error(`missing entity ${name}`)
  return definition
}

/**
 * Build one equality comparison.
 * @param field - Field name.
 * @param value - Comparison value.
 * @returns The canonical comparison filter.
 */
function eq(field: string, value: unknown): Filter {
  return { field, operator: Operator.Comparison.Equal, value }
}

/**
 * Build one entity-discriminator membership guard.
 * @param field - Discriminator path.
 * @param types - Eligible concrete entity names.
 * @returns The canonical membership filter.
 */
function guard(field: string, types: readonly string[]): Filter {
  return { field, operator: Operator.Comparison.In, value: [...types] }
}

/**
 * Build one conjunction.
 * @param filters - Child filters.
 * @returns The canonical conjunction.
 */
function and(...filters: Filter[]): Filter {
  return { filters, operator: Operator.Logical.And }
}

/**
 * Build one disjunction.
 * @param filters - Child filters.
 * @returns The canonical disjunction.
 */
function or(...filters: Filter[]): Filter {
  return { filters, operator: Operator.Logical.Or }
}

/**
 * Build one negation.
 * @param filter - Filter to negate.
 * @returns The canonical negation.
 */
function not(filter: Filter): Filter {
  return { filters: [filter], operator: Operator.Logical.Not }
}

/**
 * Build one collection filter for the document workspace members path.
 * @param filters - Member requirements.
 * @param operator - Collection operator.
 * @returns The canonical collection filter.
 */
function collection(
  filters: readonly Filter[] = [],
  operator: Operator.Comparison.Contains | Operator.Comparison.Empty = Operator.Comparison.Contains,
): Filter {
  return {
    field: 'document.workspace.members',
    filters,
    operator,
  }
}

const scalarDefinitions = load({
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
    { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'B' },
    { extends: 'A', fields: [{ field: 'bar', type: 'Number' }], name: 'C' },
    { extends: 'A', fields: [], name: 'D' },
  ],
})

const collectionDefinitions = load({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'document', target: 'Document', type: 'Entity' },
      ],
      name: 'Section',
    },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
    { extends: 'Document', fields: [], name: 'PublicDocument' },
    {
      extends: 'Document',
      fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
      name: 'PrivateDocument',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        {
          cardinality: 'Many',
          field: 'members',
          inverse: 'workspace',
          target: 'Member',
          type: 'Inverse',
        },
      ],
      name: 'Workspace',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'workspace', inverse: 'members', target: 'Workspace', type: 'Entity' },
        { field: 'role', type: 'String' },
      ],
      name: 'Member',
    },
  ],
})

const memberDefinitions = load({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'document', target: 'Document', type: 'Entity' },
      ],
      name: 'Section',
    },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
    { extends: 'Document', fields: [], name: 'PublicDocument' },
    {
      extends: 'Document',
      fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
      name: 'PrivateDocument',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        {
          cardinality: 'Many',
          field: 'members',
          inverse: 'workspace',
          target: 'Member',
          type: 'Inverse',
        },
      ],
      name: 'Workspace',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'workspace', inverse: 'members', target: 'Workspace', type: 'Entity' },
      ],
      name: 'Member',
    },
    {
      extends: 'Member',
      fields: [{ field: 'role', type: 'String' }],
      name: 'AdminMember',
    },
    { extends: 'Member', fields: [], name: 'GuestMember' },
  ],
})

const scalarA = entity(scalarDefinitions, 'A')
const scalarB = entity(scalarDefinitions, 'B')

/**
 * Lower one filter from the abstract scalar root.
 * @param filter - Normalized filter.
 * @returns Its guarded lowering.
 */
function lowerScalar(filter: Filter): Filter {
  return PredicateEligibility.lower(scalarDefinitions, scalarA, filter)
}

/**
 * Lower one filter from the Section collection root.
 * @param definitions - Collection fixture definitions.
 * @param filter - Normalized filter.
 * @returns Its guarded lowering.
 */
function lowerCollection(definitions: EntityDefinitions, filter: Filter): Filter {
  return PredicateEligibility.lower(definitions, entity(definitions, 'Section'), filter)
}

const documentGuard = guard('document.entity', ['PrivateDocument'])

describe('PredicateEligibility', () => {
  test('guards atomic equality, null equality, and inequality with the eligible type', () => {
    const foo = guard('entity', ['B'])
    expect(lowerScalar(eq('foo', 7))).toEqual(and(foo, eq('foo', 7)))
    expect(lowerScalar(eq('foo', null))).toEqual(and(foo, eq('foo', null)))
    expect(lowerScalar(Predicate.notEqual('foo', 7))).toEqual(and(foo, not(eq('foo', 7))))
    expect(lowerScalar(Predicate.notEqual('foo', null))).toEqual(and(foo, not(eq('foo', null))))
  })

  test('keeps negation outside the per-operand guard', () => {
    expect(lowerScalar(not(eq('foo', 7)))).toEqual(and(guard('entity', ['B']), not(eq('foo', 7))))
    expect(lowerScalar(not(not(eq('foo', 7))))).toEqual(
      and(guard('entity', ['B']), not(not(eq('foo', 7)))),
    )
  })

  test('preserves independent eligibility through OR and AND', () => {
    expect(lowerScalar(or(eq('foo', 7), eq('bar', 9)))).toEqual(
      or(
        and(guard('entity', ['B']), eq('foo', 7)),
        and(guard('entity', ['C']), eq('bar', 9)),
      ),
    )
    expect(lowerScalar(and(eq('foo', 7), eq('bar', 9)))).toEqual(
      and(
        guard('entity', ['B']),
        eq('foo', 7),
        guard('entity', ['C']),
        eq('bar', 9),
      ),
    )
  })

  test('composes negation of grouped predicates from applicability', () => {
    expect(lowerScalar(not(or(eq('foo', 7), eq('bar', 9))))).toEqual(
      and(
        or(guard('entity', ['B']), guard('entity', ['C'])),
        not(or(
          and(guard('entity', ['B']), eq('foo', 7)),
          and(guard('entity', ['C']), eq('bar', 9)),
        )),
      ),
    )
    expect(lowerScalar(not(and(eq('foo', 7), eq('bar', 9))))).toEqual(
      and(
        guard('entity', ['B']),
        guard('entity', ['C']),
        not(and(eq('foo', 7), eq('bar', 9))),
      ),
    )
  })

  test('requires both field operands to exist for field-to-field comparisons', () => {
    const filter: Filter = {
      field: 'foo',
      operator: Operator.Comparison.Equal,
      value: { $field: 'bar' },
    }
    expect(lowerScalar(filter)).toEqual(
      and(guard('entity', ['B']), guard('entity', ['C']), filter),
    )
  })

  test('guards descendant collection paths at the referenced occurrence', () => {
    const member = eq('role', 'admin')
    expect(lowerCollection(collectionDefinitions, collection([member]))).toEqual(
      and(documentGuard, collection([member])),
    )
    expect(lowerCollection(
      collectionDefinitions,
      collection([], Operator.Comparison.Empty),
    )).toEqual(and(documentGuard, collection([], Operator.Comparison.Empty)))
  })

  test('applies member eligibility inside the collection scope', () => {
    const member = eq('role', 'admin')
    expect(lowerCollection(memberDefinitions, collection([member]))).toEqual(
      and(
        documentGuard,
        collection([and(guard('entity', ['AdminMember']), member)]),
      ),
    )
  })

  test('keeps universal collection normalization guarded', () => {
    const member = eq('role', 'admin')
    expect(lowerCollection(
      collectionDefinitions,
      Predicate.universal('document.workspace.members', [member]),
    )).toEqual(
      and(documentGuard, not(collection([not(member)]))),
    )
  })

  test('reports applicability and original matching structure separately', () => {
    expect(PredicateEligibility.analyze(scalarDefinitions, scalarA, eq('foo', 7))).toEqual({
      applicable: guard('entity', ['B']),
      match: eq('foo', 7),
    })
    expect(PredicateEligibility.analyze(
      scalarDefinitions,
      scalarA,
      and(eq('foo', 7), eq('bar', 9)),
    )).toEqual({
      applicable: and(guard('entity', ['B']), guard('entity', ['C'])),
      match: and(eq('foo', 7), eq('bar', 9)),
    })
    expect(PredicateEligibility.analyze(
      scalarDefinitions,
      scalarA,
      or(eq('foo', 7), eq('bar', 9)),
    )).toEqual({
      applicable: or(guard('entity', ['B']), guard('entity', ['C'])),
      match: or(eq('foo', 7), eq('bar', 9)),
    })
    expect(PredicateEligibility.analyze(
      scalarDefinitions,
      scalarA,
      not(eq('foo', 7)),
    )).toEqual({
      applicable: guard('entity', ['B']),
      match: not(eq('foo', 7)),
    })
  })

  test('produces equivalent lowered trees for string and structured inputs', () => {
    const source = QueryNormalizer.normalize(scalarB, 'foo = 7')
    const structured = Predicate.normalize(scalarB, {
      field: 'foo',
      operator: Operator.Comparison.Equal,
      value: 7,
    })
    if (!source || !structured) throw new Error('expected normalized filters')
    expect(lowerScalar(source)).toEqual(lowerScalar(structured))
    expect(lowerScalar(source)).toEqual(and(guard('entity', ['B']), eq('foo', 7)))
  })

  test('is idempotent on already-lowered filters', () => {
    const scalarCases: Filter[] = [
      eq('foo', 7),
      and(eq('foo', 7), eq('bar', 9)),
      or(eq('foo', 7), eq('bar', 9)),
      not(eq('foo', 7)),
      not(or(eq('foo', 7), eq('bar', 9))),
    ]
    for (const filter of scalarCases) {
      const once = lowerScalar(filter)
      expect(lowerScalar(once)).toEqual(once)
    }
    const collectionCases: Filter[] = [
      collection([eq('role', 'admin')]),
      Predicate.universal('document.workspace.members', [eq('role', 'admin')]),
    ]
    for (const filter of collectionCases) {
      const once = lowerCollection(collectionDefinitions, filter)
      expect(lowerCollection(collectionDefinitions, once)).toEqual(once)
    }
  })
})
