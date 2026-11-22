import { describe, expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { Action, Graph, Security } from './Graph'

const read = { [Action.Read]: Security.Public } as const

const graph = new Graph({
  entities: [
    {
      fields: [],
      name: 'Workspace',
      security: read,
    },
    {
      fields: [],
      name: 'Card',
      security: read,
    },
    {
      extends: 'Card',
      fields: [],
      name: 'CustomCard',
    },
    {
      extends: 'Card',
      fields: [],
      name: 'OfficialCard',
    },
    {
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'card', target: 'Card', type: 'Entity' },
      ],
      name: 'Document',
      security: read,
    },
    {
      fields: [{ field: 'target', target: 'Entity', type: 'Entity' }],
      name: 'Link',
      security: read,
    },
  ],
})

describe('concrete identity resolution', () => {
  test('uses concrete storage for ID and static type while retaining required inherited name access', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Document', {
      fields: ['id', 'workspace.id'],
    })
    expect(sql).toMatch(/b\d+\."id" AS "workspace__id"/)
    expect(sql).not.toMatch(/r\d+\."id" AS "workspace__id"/)
    expect(sql).toContain('\'Workspace\' AS "workspace__entity"')
    expect(sql).not.toMatch(/r\d+\."entity" AS "workspace__entity"/)
    /*
     * The public reference shape always includes name, so inherited storage is
     * required even when the caller selected only workspace.id.
     */
    expect(sql).toMatch(/r\d+\."name" AS "workspace__name"/)
    expect((sql.match(/INNER JOIN "Entity"/g) ?? [])).toHaveLength(1)
  })

  test('uses the runtime discriminator for an abstract target', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Document', {
      fields: ['id', 'card.id', 'card.name'],
    })
    expect(sql).toMatch(/r\d+\."entity" AS "card__entity"/)
    expect(sql).not.toContain("'Card' AS \"card__entity\"")
  })

  test('keeps the public reference contract name and resolves it from root storage', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Document', {
      fields: ['id', 'workspace.id'],
    })
    expect(sql).toMatch(/r\d+\."name" AS "workspace__name"/)
    expect((sql.match(/INNER JOIN "Entity"/g) ?? [])).toHaveLength(1)
  })

  test('uses one concrete/root occurrence for repeated reference fields', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Document', {
      fields: ['workspace', 'workspace.name', 'workspace.id'],
    })
    expect((sql.match(/"Workspace"/g) ?? [])).toHaveLength(1)
    expect((sql.match(/INNER JOIN "Entity"/g) ?? [])).toHaveLength(1)
  })

  test('preserves the universal reference path', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Link', {
      fields: ['id', 'target', 'target.name'],
    })
    expect(sql).toContain('LEFT JOIN "Entity"')
    expect(sql).toContain('target__entity')
    expect(sql).not.toContain('JOIN "Workspace"')
  })
})
