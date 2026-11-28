import { withDatabase } from 'basis/testing'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { compileEntityQuery, queryEntity } from './Database'
import { Action, Graph, Security } from './Graph'

setDefaultTimeout(60_000)

const root = '00000000-0000-4000-8000-000000000a01'
const owner = '00000000-0000-4000-8000-000000000a10'
const firstItem = '00000000-0000-4000-8000-000000000a20'
const secondItem = '00000000-0000-4000-8000-000000000a21'
const firstItemOwner = '00000000-0000-4000-8000-000000000a30'
const secondItemOwner = '00000000-0000-4000-8000-000000000a31'
const member = (index: number): string => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`

interface Collection {
  readonly $matched: number,
  readonly $total: number,
  readonly items: readonly {
    readonly id: string,
    readonly label: string,
    readonly owner?: { readonly name: string },
  }[],
}

const graph = new Graph({
  entities: [
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'Member',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'Member', type: 'Entity' },
        { field: 'items', target: 'Item', type: 'Collection', via: 'ReachEdge[root = @].item' },
      ],
      name: 'Root',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'Member', type: 'Entity' },
      ],
      name: 'Item',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
  ],
  relationships: [{
    between: [
      { field: 'root', target: 'Root' },
      { field: 'item', target: 'Item' },
    ],
    fields: [],
    name: 'ReachEdge',
    security: {
      [Action.Read]: Security.Public,
      [Action.Create]: Security.Public,
    },
  }],
})

describe('reference reachability', () => {
  test('bounds materialized reference scans by selected identities', async () => {
    await withDatabase('collection-reference-reachability', owner, async database => {
      const compiled = compileEntityQuery(database.entities, 'Root', {
        fields: [
          'id',
          'owner.name',
          'items{$limit:null}',
          'items.label',
          'items.owner.name',
        ],
        where: { id: root },
      })
      expect(compiled.sql).toContain('"authorized_Member" AS MATERIALIZED')
      expect(compiled.sql).toContain(
        'WHERE "leaf"."id" IN (SELECT "owner.id" FROM "batch_selected_rows_0"',
      )
      expect(compiled.sql).toMatch(/"reachable_Member_\d+" AS MATERIALIZED/u)
      const explained = await database.sql.unsafe<Record<string, unknown>[]>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${compiled.sql}`,
        compiled.values,
      )
      const rawPlan = Object.values(explained[0] ?? {})[0]
      const plan = (typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan)[0].Plan
      interface PlanNode {
        readonly 'Actual Rows'?: number,
        readonly 'Node Type'?: string,
        readonly 'Plans'?: readonly PlanNode[],
        readonly 'Relation Name'?: string,
      }
      const scans: { readonly relation: string, readonly rows: number, readonly type: string }[] = []
      const walk = (node: PlanNode): void => {
        if (typeof node['Relation Name'] === 'string' && typeof node['Node Type'] === 'string') {
          scans.push({
            relation: node['Relation Name'],
            rows: Number(node['Actual Rows'] ?? 0),
            type: node['Node Type'],
          })
        }
        for (const child of node.Plans ?? []) walk(child)
      }
      walk(plan)
      const memberRows = scans
        .filter(scan => scan.relation === 'Member')
        .map(scan => scan.rows)
      expect(memberRows.length).toBeGreaterThan(0)
      expect(Math.max(...memberRows)).toBeLessThanOrEqual(2)
      const rows = await queryEntity<{
        readonly id: string,
        readonly items: Collection,
        readonly owner?: { readonly name: string },
      }>(database.sql, database.entities, 'Root', {
        fields: [
          'id',
          'owner.name',
          'items{$limit:null}',
          'items.label',
          'items.owner.name',
        ],
        where: { id: root },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.owner?.name).toBe('Owner')
      expect(rows[0]?.items.items.map(item => item.label)).toEqual(['First', 'Second'])
      expect(rows[0]?.items.items.map(item => item.owner?.name)).toEqual(['First owner', 'Second owner'])
      expect(rows[0]?.items.$matched).toBe(2)
      expect(rows[0]?.items.$total).toBe(2)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Member', [
          { id: owner, label: 'Owner', name: 'Owner' },
          { id: firstItemOwner, label: 'First owner', name: 'First owner' },
          { id: secondItemOwner, label: 'Second owner', name: 'Second owner' },
          ...Array.from({ length: 997 }, (_, index) => ({
            id: member(index),
            label: `Unrelated ${index}`,
            name: `Unrelated ${index}`,
          })),
        ])
        await database.create('Root', { id: root, label: 'Root', name: 'Root', owner })
        await database.create('Item', [
          { id: firstItem, label: 'First', name: 'First', owner: firstItemOwner },
          { id: secondItem, label: 'Second', name: 'Second', owner: secondItemOwner },
        ])
        await database.sql`
          INSERT INTO "ReachEdge" ("root.id", "item.id")
          VALUES (${root}, ${firstItem}), (${root}, ${secondItem})
        `
      },
    })
  })
})
