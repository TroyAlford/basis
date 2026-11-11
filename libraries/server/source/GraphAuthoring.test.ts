import { describe, expect, test } from 'bun:test'
import { FieldType } from './EntityDefinitions'
import { Graph } from './Graph'
import { Server } from './Server'

/**
 * Compile-only invalid authoring examples.
 */
function invalidAuthoring(): void {
  // @ts-expect-error field kinds use the canonical closed vocabulary
  new Graph({ entities: [{ fields: [{ field: 'bad', type: 'Unknown' }], name: 'Bad' }] })
  // @ts-expect-error a reference field requires a target entity
  new Graph({ entities: [{ fields: [{ field: 'owner', type: FieldType.Entity }], name: 'Bad' }] })
  // @ts-expect-error inverse cardinality must be One or Many
  new Graph({ entities: [{ fields: [{ cardinality: 'Sometimes', field: 'owners', inverse: 'owner', target: 'User', type: FieldType.Inverse }], name: 'Bad' }] }) // eslint-disable-line @stylistic/max-len
  // @ts-expect-error relationship-owned fields cannot be entity references
  new Graph({ relationships: [{ between: [{ field: 'user', inverse: 'teams', target: 'User' }, { field: 'team', inverse: 'members', target: 'User' }], fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }], name: 'Membership' }] }) // eslint-disable-line @stylistic/max-len
}

void invalidAuthoring

describe('Graph authoring types', () => {
  test('accepts enum-based native authoring', () => {
    const graph = new Graph({
      entities: [{
        fields: [
          { field: 'title', type: FieldType.String },
          { field: 'owner', target: 'User', type: FieldType.Entity },
        ],
        name: 'Note',
      }],
    })
    expect(graph.definitions.entity('Note')?.fields.find(field => field.name === 'title')?.type).toBe(FieldType.String)
  })

  test('keeps runtime validation authoritative for dynamic JSON', () => {
    expect(() => new Graph({ entities: '{"entities":[{"fields":[],"name":"Role"}]}' })).toThrow('reserved by Basis authorization') // eslint-disable-line @stylistic/max-len
    expect(() => new Graph({ entities: '{"entities":[{"fields":[{"field":"owner","target":"Missing","type":"Entity"}],"name":"Note"}]}' })) // eslint-disable-line @stylistic/max-len
      .toThrow('unknown target entity "Missing"')
    expect(() => new Graph({ entities: 'null' })).toThrow('entities must be an authored document or entity array')
    expect(() => new Graph({ entities: '{"entites":[{"name":"Note","fields":[]}]}' }))
      .toThrow('unknown top-level property "entites"')
    expect(() => new Graph({
      entities: { entites: [], entities: [{ fields: [], name: 'Note' }] } as never,
    })).toThrow('unknown top-level property "entites"')
  })

  test('rejects a pre-validated EntityDefinitions model', () => {
    const definitions = new Graph({ entities: [{ fields: [], name: 'Note' }] }).definitions
    expect(() => new Graph({ entities: definitions } as never))
      .toThrow('pass authored entities')
  })

  test('rejects a second database model when a Graph is installed', () => {
    const graph = new Graph({ entities: [{ fields: [], name: 'Note' }] })
    expect(() => new Server().graph(graph).database({ entities: graph.definitions } as never))
      .toThrow('unsupported database option')
  })
})
