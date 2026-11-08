import { describe, expect, test } from 'bun:test'
import { Cardinality, defineEntities, generateErd, generateJSONSchemas, generateProducts, generateTypes } from './Authoring'
import { EntityDefinitions, FieldType } from './EntityDefinitions'
import { Graph } from './Graph'

const document = {
  entities: [
    {
      fields: [
        { field: 'email', type: FieldType.String as const },
        {
          cardinality: Cardinality.Many,
          field: 'notes',
          inverse: 'owner',
          target: 'Note',
          type: FieldType.Inverse as const,
        },
      ],
      name: 'User',
    },
    {
      fields: [
        { field: 'title', type: FieldType.String as const },
        { field: 'owner', inverse: 'notes', target: 'User', type: FieldType.Entity as const },
        { field: 'tags', items: { type: FieldType.String as const }, type: FieldType.Array as const },
        { field: 'metadata', type: FieldType.JSON as const },
      ],
      name: 'Note',
    },
  ],
  relationships: [{
    between: [
      { field: 'user', inverse: 'teams', target: 'User' },
      { field: 'team', inverse: 'members', target: 'Note' },
    ],
    fields: [{ field: 'role', type: FieldType.String as const }],
    name: 'Membership',
  }],
} as const

describe('typed authoring and generated products', () => {
  test('uses the canonical validator and produces the same physical model as JSON', () => {
    const typed = defineEntities(document)
    const json = EntityDefinitions.load(JSON.stringify(document))
    expect(typed.physicalSchema('basis_app', false, false))
      .toEqual(json.physicalSchema('basis_app', false, false))
    expect(generateProducts(typed)).toEqual(generateProducts(json))
    expect(typed.entities.map(entity => entity.name)).toEqual(['User', 'Note'])
    const graph = new Graph({ entities: typed })
    expect(graph.definitions.entity('Note')?.effectiveFields.some(field => field.name === 'owner')).toBe(true)
  })

  test('generates deterministic types, schemas, and both ERDs', () => {
    const definitions = defineEntities(document)
    const first = generateProducts(definitions)
    const second = generateProducts(definitions)
    expect(first).toEqual(second)
    expect(first.types).toContain('export interface Note extends Entity')
    expect(first.types).toContain('export type NoteRef')
    expect(first.types).toContain('readonly owner: UserRef')
    expect(first.schemas.Note?.output).toBeDefined()
    expect(first.schemas.Note?.create).toBeDefined()
    expect(first.logicalErd).toContain('erDiagram')
    expect(first.logicalErd).toContain('User ||--o{ Note : owner')
    expect(first.physicalErd).toContain('Entity ||--o{ User : extends')
    expect(first.physicalErd).toContain('Note')
    expect(generateTypes(definitions)).toBe(first.types)
    expect(generateJSONSchemas(definitions)).toEqual(first.schemas)
    expect(generateErd(definitions, 'logical')).toBe(first.logicalErd)
    expect(generateErd(definitions, 'physical')).toBe(first.physicalErd)
  })
})
