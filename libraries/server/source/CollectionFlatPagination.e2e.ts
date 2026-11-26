import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { compileEntityQuery, queryEntity } from './Database'
import { Action, Graph, Security } from './Graph'

const parent = '00000000-0000-4000-8000-000000000701'
const other = '00000000-0000-4000-8000-000000000799'
const ownerUser = '00000000-0000-4000-8000-0000000007a0'
const child = (index: number): string => `00000000-0000-4000-8000-0000000008${String(index).padStart(2, '0')}`
const grandchild = (index: number): string => `00000000-0000-4000-8000-0000000009${String(index).padStart(2, '0')}`
const unrelated = (index: number): string => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`

interface Collection {
  readonly $matched: number,
  readonly $total: number,
  readonly items: readonly { readonly grandchildren?: Collection, readonly id: string }[],
}

const graph = new Graph({
  entities: [
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'User',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'children', target: 'Child', type: 'Collection', via: 'ParentChild[parent = @].child' },
      ],
      name: 'Parent',
      security: {
        [Action.Read]: { where: 'owner = $me' },
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
        {
          field: 'grandchildren',
          target: 'Grandchild',
          type: 'Collection',
          via: 'ChildGrandchild[child = @].grandchild',
        },
      ],
      name: 'Child',
      security: {
        [Action.Read]: { where: 'owner = $me' },
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [{ field: 'label', type: 'String' }, { field: 'owner', target: 'User', type: 'Entity' }],
      name: 'Grandchild',
      security: {
        [Action.Read]: { where: 'owner = $me' },
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'Tag',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
  ],
  relationships: [
    {
      between: [
        { field: 'parent', target: 'Parent' },
        { field: 'child', target: 'Child' },
        { field: 'tag', target: 'Tag' },
      ],
      fields: [],
      name: 'ParentChild',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
    {
      between: [{ field: 'child', target: 'Child' }, { field: 'grandchild', target: 'Grandchild' }],
      fields: [],
      name: 'ChildGrandchild',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
  ],
})

describe('flat collection pagination', () => {
  test('scopes nested collections to the selected parent page', async () => {
    await withDatabase('flat-collection-pagination', ownerUser, async database => {
      const options = {
        fields: [
          'id',
          'children{$limit:2}',
          'children.label',
          'children.grandchildren{$limit:null}',
          'children.grandchildren.label',
        ],
        where: { id: parent },
      }
      const rows = await queryEntity<{ readonly children: Collection, readonly id: string }>(
        database.sql,
        database.entities,
        'Parent',
        options,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.children.items).toHaveLength(2)
      expect(rows[0]?.children.items.map(item => item.id)).toEqual([child(0), child(1)])
      expect(rows[0]?.children.$total).toBe(5)
      expect(rows[0]?.children.$matched).toBe(5)
      for (const item of rows[0]?.children.items ?? []) {
        expect(item.grandchildren?.items).toHaveLength(5)
        expect(item.grandchildren?.$total).toBe(5)
      }
      const offsetOptions = {
        fields: [
          'id',
          'children{$limit:2,$offset:2}',
          'children.label',
          'children.grandchildren{$limit:null}',
          'children.grandchildren.label',
        ],
        where: { id: parent },
      }
      const offsetRows = await queryEntity<{ readonly children: Collection, readonly id: string }>(
        database.sql,
        database.entities,
        'Parent',
        offsetOptions,
      )
      expect(offsetRows[0]?.children.items.map(item => item.id)).toEqual([child(2), child(3)])
      expect(offsetRows[0]?.children.$total).toBe(5)
      for (const item of offsetRows[0]?.children.items ?? []) {
        expect(item.grandchildren?.items).toHaveLength(5)
      }
      const compiled = compileEntityQuery(database.entities, 'Parent', options)
      expect(compiled.sql).toContain('flat_scope_')
      expect(compiled.sql).toContain('FROM "flat_scope_')
      const explained = await database.sql.unsafe<Record<string, unknown>[]>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${compiled.sql}`,
        compiled.values,
      )
      const rawPlan = Object.values(explained[0] ?? {})[0]
      const plan = (typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan)[0].Plan
      interface PlanNode {
        readonly 'Actual Rows'?: number,
        readonly 'CTE Name'?: string,
        readonly 'Plans'?: readonly PlanNode[],
      }
      const scopes: number[] = []
      const rootRows: number[] = []
      const targetRows: number[] = []
      const walk = (node: PlanNode): void => {
        if (typeof node['CTE Name'] === 'string') {
          if (node['CTE Name'].startsWith('flat_scope_')) scopes.push(Number(node['Actual Rows'] ?? 0))
          if (node['CTE Name'].startsWith('batch_selected_rows_')) rootRows.push(Number(node['Actual Rows'] ?? 0))
          if (node['CTE Name'].startsWith('flat_targets_')) targetRows.push(Number(node['Actual Rows'] ?? 0))
        }
        for (const childNode of node.Plans ?? []) walk(childNode)
      }
      walk(plan)
      const scans: { relation: string, rows: number, type: string }[] = []
      const scanWalk = (node: PlanNode): void => {
        if (typeof node['Relation Name'] === 'string' && typeof node['Node Type'] === 'string') {
          scans.push({
            relation: node['Relation Name'],
            rows: Number(node['Actual Rows'] ?? 0),
            type: node['Node Type'],
          })
        }
        for (const childNode of node.Plans ?? []) scanWalk(childNode)
      }
      scanWalk(plan)
      expect(plan['Shared Hit Blocks']).toBeLessThan(200)
      const parentScan = scans.find(scan => scan.relation === 'Parent')
      const childScan = scans.find(scan => scan.relation === 'Child')
      const grandchildScan = scans.find(scan => scan.relation === 'Grandchild')
      expect(parentScan?.type).toBe('Index Scan')
      expect(parentScan?.rows).toBeLessThanOrEqual(1)
      expect(childScan?.rows).toBeLessThanOrEqual(2)
      expect(grandchildScan?.rows).toBeLessThanOrEqual(10)
      expect(compiled.sql).toContain('authorized_Parent" AS NOT MATERIALIZED')
      expect(compiled.sql).toContain('authorized_Child" AS NOT MATERIALIZED')
      expect(scopes.length).toBeGreaterThan(0)
      expect(scopes[0]).toBeLessThanOrEqual(2)
      expect(rootRows.length).toBeGreaterThan(0)
      expect(Math.max(...rootRows)).toBeLessThanOrEqual(1)
      expect(targetRows.length).toBeGreaterThan(0)
      expect(Math.max(...targetRows)).toBeLessThanOrEqual(10)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('User', [
          { id: ownerUser, label: 'Owner', name: 'Owner' },
          { id: other, label: 'Other', name: 'Other' },
        ])
        await database.create('Parent', { id: parent, label: 'Parent', name: 'Parent', owner: ownerUser })
        await database.create('Parent', Array.from({ length: 1000 }, (_, index) => ({
          id: unrelated(index),
          label: `Unrelated ${index}`,
          name: `Unrelated ${index}`,
          owner: ownerUser,
        })))
        const children = Array.from({ length: 5 }, (_, index) => ({
          id: child(index),
          label: `Child ${index}`,
          name: `Child ${index}`,
          owner: ownerUser,
        }))
        await database.create('Child', children)
        await database.create('Child', Array.from({ length: 1000 }, (_, index) => ({
          id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
          label: `Unrelated child ${index}`,
          name: `Unrelated child ${index}`,
          owner: ownerUser,
        })))
        const grandchildren = Array.from({ length: 25 }, (_, index) => ({
          id: grandchild(index),
          label: `Grandchild ${index}`,
          name: `Grandchild ${index}`,
          owner: ownerUser,
        }))
        await database.create('Grandchild', grandchildren)
        await database.create('Tag', [
          { id: '00000000-0000-4000-8000-000000000b01', label: 'Tag 1', name: 'Tag 1' },
          { id: '00000000-0000-4000-8000-000000000b02', label: 'Tag 2', name: 'Tag 2' },
        ])
        for (const [index, row] of children.entries()) {
          await database.sql`
            INSERT INTO "ParentChild" ("parent.id", "child.id", "tag.id")
            VALUES (${parent}, ${row.id}, '00000000-0000-4000-8000-000000000b01')
          `
          if (index === 0) {
            await database.sql`
              INSERT INTO "ParentChild" ("parent.id", "child.id", "tag.id")
              VALUES (${parent}, ${row.id}, '00000000-0000-4000-8000-000000000b02')
            `
          }
          for (let offset = 0; offset < 5; offset += 1) {
            await database.sql`
              INSERT INTO "ChildGrandchild" ("child.id", "grandchild.id")
              VALUES (${row.id}, ${grandchild((index * 5) + offset)})
            `
          }
        }
      },
    })
  })
})
