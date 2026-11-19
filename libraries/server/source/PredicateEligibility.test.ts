import { describe, expect, test } from 'bun:test'
import type { EntityDefinition, EntityDefinitions } from './EntityDefinitions'
import { EntityDefinitions as Definitions } from './EntityDefinitions'
import { Operator } from './Operator'
import { resolvePredicatePath } from './PathResolution'
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
  operator:
    | Operator.Collection.All
    | Operator.Comparison.Contains
    | Operator.Comparison.Empty = Operator.Comparison.Contains,
): Filter {
  return {
    field: 'document.workspace.members',
    filters,
    operator,
  }
}

const scalarDefinitions = load({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'createdAt', type: 'Timestamp' },
        { field: 'ratings', items: { type: 'Number' }, type: 'Array' },
      ],
      name: 'A',
    },
    {
      extends: 'A',
      fields: [
        { field: 'foo', type: 'Number' },
        { field: 'scores', items: { type: 'Number' }, type: 'Array' },
      ],
      name: 'B',
    },
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

const generatedDefinitions = load({
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
    {
      extends: 'A',
      fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
      name: 'B',
    },
    { extends: 'A', fields: [], name: 'C' },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
    { extends: 'Document', fields: [], name: 'PublicDocument' },
    {
      extends: 'Document',
      fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
      name: 'PrivateDocument',
    },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Workspace' },
  ],
})

const referenceDefinitions = load({
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
    {
      extends: 'A',
      fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
      name: 'B',
    },
    { extends: 'A', fields: [], name: 'C' },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
  ],
})

const scalarA = entity(scalarDefinitions, 'A')
const scalarB = entity(scalarDefinitions, 'B')

/**
 * Resolve one field path through the canonical resolver.
 * @param definitions - Canonical definitions.
 * @param startEntity - Start entity.
 * @returns A resolver for logical field paths.
 */
function fieldResolver(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
): (name: string) => ReturnType<typeof Predicate.field> {
  return name => {
    const path = resolvePredicatePath(startEntity, name, { definitions })
    if ('kind' in path) throw new Error(`Path "${name}" failed: ${path.kind}`)
    if ('kind' in path.terminal) throw new Error(`Path "${name}" is a collection`)
    return path.terminal
  }
}

const resolveB = fieldResolver(scalarDefinitions, scalarB)

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

  test('preserves distinct Date operands through structural deduplication', () => {
    const first = new Date('2026-01-01T00:00:00.000Z')
    const second = new Date('2026-02-01T00:00:00.000Z')
    const filters = [eq('createdAt', first), eq('createdAt', second)] as const
    expect(lowerScalar(or(...filters))).toEqual(or(...filters))
    expect(lowerScalar(and(...filters))).toEqual(and(...filters))
  })

  test('treats a universal OR operand as universally applicable', () => {
    const foo = guard('entity', ['B'])
    const universal = eq('name', 'Example')
    expect(PredicateEligibility.analyze(
      scalarDefinitions,
      scalarA,
      or(eq('foo', 7), universal),
    )).toEqual({
      applicable: null,
      match: or(eq('foo', 7), universal),
    })
    expect(lowerScalar(or(eq('foo', 7), universal))).toEqual(
      or(and(foo, eq('foo', 7)), universal),
    )
    expect(lowerScalar(not(or(eq('foo', 7), universal)))).toEqual(
      not(or(and(foo, eq('foo', 7)), universal)),
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

  test('preserves native-array member predicates in their member scope', () => {
    const member: Filter = { field: '@', operator: Operator.Comparison.GreaterThan, value: 0 }
    const scores: Filter = {
      field: 'scores',
      filters: [member],
      operator: Operator.Comparison.Contains,
    }
    const scoresGuard = guard('entity', ['B'])
    expect(lowerScalar(scores)).toEqual(and(scoresGuard, scores))
    expect(lowerScalar(Predicate.universal('scores', [member]))).toEqual(
      and(scoresGuard, {
        field: 'scores',
        filters: [member],
        operator: Operator.Collection.All,
      }),
    )
    const ratings: Filter = {
      field: 'ratings',
      filters: [member],
      operator: Operator.Comparison.Contains,
    }
    expect(lowerScalar(ratings)).toEqual(ratings)
    expect(() => lowerScalar({
      field: 'name',
      filters: [member],
      operator: Operator.Comparison.Contains,
    })).toThrow('not a collection or native array')
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
      and(documentGuard, collection([member], Operator.Collection.All)),
    )
  })

  test('guards universal member eligibility inside the quantifier', () => {
    const member = eq('role', 'admin')
    const lowered = lowerCollection(
      memberDefinitions,
      Predicate.universal('document.workspace.members', [member]),
    )
    expect(lowered).toEqual(
      and(
        documentGuard,
        collection([
          and(guard('entity', ['AdminMember']), member),
        ], Operator.Collection.All),
      ),
    )
    expect(lowerCollection(memberDefinitions, lowered)).toEqual(lowered)
  })

  test('keeps ordinary member negation guarded outside universal quantification', () => {
    const member = eq('role', 'admin')
    expect(lowerCollection(
      memberDefinitions,
      collection([not(member)]),
    )).toEqual(
      and(
        documentGuard,
        collection([and(guard('entity', ['AdminMember']), not(member))]),
      ),
    )
  })

  test('analyzes user-authored dotted entity comparisons instead of treating them as guards', () => {
    const filter: Filter = {
      field: 'document.entity',
      operator: Operator.Comparison.In,
      value: ['Document'],
    }
    const start = entity(referenceDefinitions, 'A')
    expect(PredicateEligibility.analyze(referenceDefinitions, start, filter)).toEqual({
      applicable: guard('entity', ['B']),
      match: filter,
    })
    expect(PredicateEligibility.lower(referenceDefinitions, start, filter)).toEqual(
      and(guard('entity', ['B']), filter),
    )
  })

  test('analyzes generated, cloned, and authored guards identically', () => {
    const start = entity(generatedDefinitions, 'A')
    const lowered = PredicateEligibility.lower(generatedDefinitions, start, {
      field: 'document.workspace',
      operator: Operator.Comparison.Equal,
      value: null,
    })
    if (!('filters' in lowered)) throw new Error('expected guarded conjunction')
    const generated = lowered.filters.find(filter => (
      'field' in filter && filter.field === 'document.entity'
    ))
    if (!generated) throw new Error('missing generated dotted guard')
    const authored: Filter = {
      field: 'document.entity',
      operator: Operator.Comparison.In,
      value: ['PrivateDocument'],
    }
    const variants: Filter[] = [
      generated,
      { ...generated },
      structuredClone(generated),
      JSON.parse(JSON.stringify(generated)) as Filter,
      authored,
    ]
    const expectedAnalysis = {
      applicable: guard('entity', ['B']),
      match: authored,
    }
    const expectedLower = and(guard('entity', ['B']), authored)
    const expectedNegated = and(guard('entity', ['B']), not(authored))
    for (const variant of variants) {
      expect(PredicateEligibility.analyze(generatedDefinitions, start, variant))
        .toEqual(expectedAnalysis)
      expect(PredicateEligibility.lower(generatedDefinitions, start, variant))
        .toEqual(expectedLower)
      expect(PredicateEligibility.lower(generatedDefinitions, start, not(variant)))
        .toEqual(expectedNegated)
      expect(PredicateEligibility.lower(
        generatedDefinitions,
        start,
        PredicateEligibility.lower(generatedDefinitions, start, variant),
      )).toEqual(expectedLower)
    }
  })

  test('guards count paths with owner eligibility and source/structured parity', () => {
    const scores = {
      field: 'scores.$total',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 2,
    }
    const source = QueryNormalizer.normalize(scalarB, 'scores.$total >= 2', resolveB)
    const structured = Predicate.normalize(scalarB, scores, resolveB)
    if (!source || !structured) throw new Error('expected normalized filters')
    expect(lowerScalar(source)).toEqual(lowerScalar(structured))
    expect(lowerScalar(source)).toEqual(and(guard('entity', ['B']), scores))

    const ratings = {
      field: 'ratings.$total',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 1,
    }
    expect(lowerScalar(ratings)).toEqual(ratings)

    const sectionEntity = entity(collectionDefinitions, 'Section')
    const resolveSection = fieldResolver(collectionDefinitions, sectionEntity)
    const memberCount = {
      field: 'document.workspace.members.$total',
      operator: Operator.Comparison.Equal,
      value: 0,
    }
    const sourceCount = QueryNormalizer.normalize(
      sectionEntity,
      'document.workspace.members.$total = 0',
      resolveSection,
    )
    const structuredCount = Predicate.normalize(sectionEntity, memberCount, resolveSection)
    if (!sourceCount || !structuredCount) throw new Error('expected normalized filters')
    expect(lowerCollection(collectionDefinitions, sourceCount))
      .toEqual(lowerCollection(collectionDefinitions, structuredCount))
    expect(lowerCollection(collectionDefinitions, sourceCount))
      .toEqual(and(documentGuard, memberCount))

    const matched = {
      field: 'document.workspace.members.$matched',
      operator: Operator.Comparison.Equal,
      value: 0,
    }
    expect(lowerCollection(collectionDefinitions, matched)).toEqual(and(documentGuard, matched))
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
    const source = QueryNormalizer.normalize(scalarB, 'foo = 7', resolveB)
    const structured = Predicate.normalize(scalarB, {
      field: 'foo',
      operator: Operator.Comparison.Equal,
      value: 7,
    }, resolveB)
    if (!source || !structured) throw new Error('expected normalized filters')
    expect(lowerScalar(source)).toEqual(lowerScalar(structured))
    expect(lowerScalar(source)).toEqual(and(guard('entity', ['B']), eq('foo', 7)))

    const sourceOr = QueryNormalizer.normalize(
      scalarB,
      "foo = 7 $or name = 'Example'",
      resolveB,
    )
    const structuredOr = Predicate.normalize(scalarB, {
      filters: [
        { field: 'foo', operator: Operator.Comparison.Equal, value: 7 },
        { field: 'name', operator: Operator.Comparison.Equal, value: 'Example' },
      ],
      operator: Operator.Logical.Or,
    }, resolveB)
    if (!sourceOr || !structuredOr) throw new Error('expected normalized filters')
    expect(lowerScalar(sourceOr)).toEqual(lowerScalar(structuredOr))
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
