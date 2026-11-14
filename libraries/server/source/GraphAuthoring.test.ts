import { describe, expect, test } from 'bun:test'
import { Constraint, FieldType } from './EntityDefinitions'
import { Action, Graph, Security } from './Graph'
import { Operator } from './Operator'
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

  test('accepts default field authoring', () => {
    const graph = new Graph({
      entities: [{
        fields: [{ default: false, field: 'active', type: FieldType.Boolean }],
        name: 'Account',
      }],
    })
    expect(graph.definitions.entity('Account')?.fields.find(field => field.name === 'active'))
      .toMatchObject({ default: false, type: FieldType.Boolean })
  })

  test('accepts typed uniqueness constraints', () => {
    const graph = new Graph({
      entities: [{
        constraints: [{
          description: 'One label per account.',
          fields: ['label'],
          name: 'One Label Per Account',
          type: Constraint.Uniqueness,
        }],
        fields: [{ field: 'label', type: FieldType.String, unique: true }],
        name: 'Account',
      }],
    })
    expect(graph.definitions.constraints).toHaveLength(2)
    expect(graph.definitions.constraints.every(constraint => constraint.type === Constraint.Uniqueness))
      .toBe(true)
  })

  test('accepts typed capabilities and entity security', () => {
    enum Capability {
      View = 'viewAccount',
    }
    const graph = new Graph({
      entities: [{
        fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }],
        name: 'Account',
        security: {
          [Action.Read]: [{
            grant: Capability.View,
            where: { field: 'owner', operator: Operator.Comparison.Equal, value: '$me' },
          }],
          [Action.Update]: Security.Public,
        },
      }],
      grants: { [Capability.View]: { description: 'View accounts' } },
      roles: { viewer: { grants: [Capability.View], name: 'Viewer' } },
    })
    expect(graph.security).toHaveLength(2)
    expect(graph.capabilities).toEqual([{ description: 'View accounts', name: Capability.View }])
  })

  test('accepts nullable field authoring', () => {
    const graph = new Graph({
      entities: [{
        fields: [{ field: 'retiredAt', nullable: true, type: FieldType.Timestamp }],
        name: 'Account',
      }],
    })
    const field = graph.definitions.entity('Account')?.fields.find(candidate => candidate.name === 'retiredAt')
    expect((field as { nullable?: boolean } | undefined)?.nullable).toBe(true)
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
