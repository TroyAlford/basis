import { expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { Action, Graph, Security } from './Graph'
import { compilePolymorphicQuery } from './PolymorphicQuery'

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

test('projects inherited fields from the authorized CTE instead of external ancestors', () => {
  const { sql } = compileEntityQuery(graph.definitions, 'Document', {
    fields: ['id', 'workspace.name', 'card.name'],
  })
  expect(sql).toContain('"root"."name" AS "name"')
  expect(sql).toContain('LEFT JOIN "authorized_Workspace" "b1"')
  expect(sql).toContain('b1."name"')
  expect(sql).not.toContain('FROM "authorized_Document" "t" JOIN "Entity"')
})

test('does not rewrite SQL literals or comments as relation references', () => {
  const definition = graph.definitions.entity('Document')
  if (!definition) throw new Error('Document definition missing')
  const { sql } = compilePolymorphicQuery(graph.definitions, definition, {
    fields: ['id'],
    rawWhere: { sql: '1 = 1 /* FROM "Unrelated" */', values: [] },
  })
  expect(sql).toContain('/* FROM "Unrelated" */')
  expect(sql).not.toContain('authorized_Unrelated')
})

test('uses authorized relations for nested collection correlations', () => {
  const collectionGraph = new Graph({
    entities: [
      {
        fields: [{
          cardinality: 'Many',
          field: 'books',
          inverse: 'shelf',
          target: 'Book',
          type: 'Inverse',
        }],
        name: 'Shelf',
        security: publicRead,
      },
      {
        fields: [{ field: 'shelf', inverse: 'books', target: 'Shelf', type: 'Entity' }],
        name: 'Book',
        security: publicRead,
      },
    ],
  })
  const { sql } = compileEntityQuery(collectionGraph.definitions, 'Shelf', {
    fields: ['id', 'books{$limit:1}'],
  })
  expect(sql).toContain('FROM "authorized_Shelf" "t"')
  expect(sql).toContain('"authorized_Book" "ct')
  expect(sql).toContain('"shelf.id"')
  expect(sql).not.toContain('JOIN ("Book"')
})

test('quotes CTE output aliases and resolves quoted field identifiers', () => {
  const quotedGraph = new Graph({
    entities: [{
      fields: [{ field: 'select', type: 'String' }],
      name: 'Thing',
      security: publicRead,
    }],
  })
  const { sql } = compileEntityQuery(quotedGraph.definitions, 'Thing', {
    fields: ['id', 'select'],
  })
  expect(sql).toContain('"leaf"."select" AS "select"')
  expect(sql).toContain('t."select" AS "select"')
  expect(sql).toContain('FROM "authorized_Thing" "t"')
})
