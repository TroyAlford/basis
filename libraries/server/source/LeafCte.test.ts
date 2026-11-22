import { expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { Action, Graph, Security } from './Graph'

const publicRead = { [Action.Read]: Security.Public } as const
const graph = new Graph({
  entities: [
    { fields: [], name: 'Workspace', security: publicRead },
    { fields: [], name: 'Card', security: publicRead },
    { extends: 'Card', fields: [], name: 'CustomCard' },
    { extends: 'Card', fields: [], name: 'OfficialCard' },
    {
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'card', target: 'Card', type: 'Entity' },
        { field: 'backup', target: 'Workspace', type: 'Entity' },
      ],
      name: 'Document',
      security: publicRead,
    },
    { fields: [], name: 'Unrelated', security: publicRead },
  ],
})

test('wraps concrete roots in leaf-rooted ancestor CTEs', () => {
  const { sql } = compileEntityQuery(graph.definitions, 'Document', {
    fields: ['id', 'workspace.name'],
  })
  expect(sql).toContain('WITH "authorized_Document"')
  expect(sql).toContain('FROM "authorized_Document"')
  expect(sql).toContain('FROM "Document" "leaf" JOIN "Entity" "root"')
  expect(sql).not.toContain('"authorized_Entity"')
})

test('composes abstract targets from concrete leaf CTEs', () => {
  const { sql } = compileEntityQuery(graph.definitions, 'Document', {
    fields: ['id', 'card.name'],
  })
  expect(sql).toContain('"authorized_Card" AS NOT MATERIALIZED')
  expect(sql).toContain('FROM "CustomCard" "leaf"')
  expect(sql).toContain('FROM "OfficialCard" "leaf"')
  expect(sql).toContain(' UNION ALL ')
  expect(sql).toContain('"root"."entity" AS "entity"')
  expect(sql).toContain('"authorized_Card" "b1"')
})

test('reuses one CTE definition for repeated references and omits unrelated leaves', () => {
  const { sql } = compileEntityQuery(graph.definitions, 'Document', {
    fields: ['id', 'workspace', 'workspace.name', 'backup.name'],
  })
  expect((sql.match(/"authorized_Workspace" AS NOT MATERIALIZED/g) ?? [])).toHaveLength(1)
  expect(sql).not.toContain('authorized_Unrelated')
})
