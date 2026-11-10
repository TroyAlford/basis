import { Cardinality, EntityDefinitions, FieldType } from 'basis/server'
import { renderMermaidSVG } from 'beautiful-mermaid'
import { describe, expect, test } from 'bun:test'
import { generateErd } from './Erd'

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
        { field: 'dueOn', type: FieldType.Date as const },
        { field: 'createdAt', type: FieldType.Timestamp as const },
        { field: 'subject', target: 'Entity', type: FieldType.Entity as const },
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

describe('ERD generation', () => {
  test('generates deterministic logical and physical diagrams', () => {
    const definitions = EntityDefinitions.fromDocument(document)
    const logical = generateErd(definitions, 'logical')
    const physical = generateErd(definitions, 'physical')
    expect(generateErd(definitions, 'logical')).toBe(logical)
    expect(logical).toContain('erDiagram')
    expect(logical).toContain('User ||--o{ Note : owner')
    expect(logical).toContain('Ref owner "nullable"')
    expect(logical).toContain('string[] tags')
    expect(physical).toContain('Entity ||--o{ User : id')
    expect(physical).toContain('Note')
    const svg = renderMermaidSVG(logical)
    expect(svg).toContain('owner')
    expect(svg).toContain('tags')
  })
})
