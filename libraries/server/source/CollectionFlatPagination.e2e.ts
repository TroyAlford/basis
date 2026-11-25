import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { compileEntityQuery, queryEntity } from './Database'
import { Action, Graph, Security } from './Graph'

const parent = '00000000-0000-4000-8000-000000000701'
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
      fields: [
        { field: 'label', type: 'String' },
        { field: 'children', target: 'Child', type: 'Collection', via: 'ParentChild[parent = @].child' },
      ],
      name: 'Parent',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        {
          field: 'grandchildren',
          target: 'Grandchild',
          type: 'Collection',
          via: 'ChildGrandchild[child = @].grandchild',
        },
      ],
      name: 'Child',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'Grandchild',
      security: { [Action.Read]: Security.Public },
    },
  ],
  relationships: [
    {
      between: [{ field: 'parent', target: 'Parent' }, { field: 'child', target: 'Child' }],
      fields: [],
      name: 'ParentChild',
      security: { [Action.Read]: Security.Public },
    },
    {
      between: [{ field: 'child', target: 'Child' }, { field: 'grandchild', target: 'Grandchild' }],
      fields: [],
      name: 'ChildGrandchild',
      security: { [Action.Read]: Security.Public },
    },
  ],
})

describe('flat collection pagination', () => {
  test('scopes nested collections to the selected parent page', async () => {
    await withDatabase('flat-collection-pagination', null, async database => {
      const options = {
        fields: [
          'id',
          'children{$limit:1,$offset:2}',
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
      expect(rows[0]?.children.items).toHaveLength(1)
      expect(rows[0]?.children.items[0]?.id).toBe(child(2))
      expect(rows[0]?.children.$total).toBe(5)
      expect(rows[0]?.children.$matched).toBe(5)
      expect(rows[0]?.children.items[0]?.grandchildren?.items).toHaveLength(5)
      expect(rows[0]?.children.items[0]?.grandchildren?.$total).toBe(5)
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
      expect(compiled.sql).toContain('authorized_Parent" AS NOT MATERIALIZED')
      expect(compiled.sql).toContain('authorized_Child" AS NOT MATERIALIZED')
      expect(scopes.length).toBeGreaterThan(0)
      expect(Math.max(...scopes)).toBeLessThanOrEqual(1)
      expect(rootRows.length).toBeGreaterThan(0)
      expect(Math.max(...rootRows)).toBeLessThanOrEqual(1)
      expect(targetRows.length).toBeGreaterThan(0)
      expect(Math.max(...targetRows)).toBeLessThanOrEqual(5)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Parent', { id: parent, label: 'Parent', name: 'Parent' })
        await database.create('Parent', Array.from({ length: 1000 }, (_, index) => ({
          id: unrelated(index),
          label: `Unrelated ${index}`,
          name: `Unrelated ${index}`,
        })))
        const children = Array.from({ length: 5 }, (_, index) => ({
          id: child(index),
          label: `Child ${index}`,
          name: `Child ${index}`,
        }))
        await database.create('Child', children)
        await database.create('Child', Array.from({ length: 1000 }, (_, index) => ({
          id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
          label: `Unrelated child ${index}`,
          name: `Unrelated child ${index}`,
        })))
        const grandchildren = Array.from({ length: 25 }, (_, index) => ({
          id: grandchild(index),
          label: `Grandchild ${index}`,
          name: `Grandchild ${index}`,
        }))
        await database.create('Grandchild', grandchildren)
        for (const [index, row] of children.entries()) {
          await database.sql`
            INSERT INTO "ParentChild" ("parent.id", "child.id")
            VALUES (${parent}, ${row.id})
          `
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
