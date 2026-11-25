import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'

interface BatchItem {
  readonly label?: string,
  readonly quantity?: number,
}

interface BatchCollection {
  readonly items: readonly BatchItem[],
}

interface BatchRow {
  readonly entries: BatchCollection,
  readonly members: BatchCollection,
}

const group = '00000000-0000-4000-8000-000000000501'
const memberA = '00000000-0000-4000-8000-000000000502'
const memberB = '00000000-0000-4000-8000-000000000503'

const graph = new Graph({
  entities: [
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'members', target: 'Member', type: 'Collection', via: 'GroupMember[group = @].member' },
        { field: 'entries', target: 'GroupMember', type: 'Collection', via: 'GroupMember[group = @]' },
      ],
      name: 'Group',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'Member',
      security: { [Action.Read]: Security.Public },
    },
  ],
  relationships: [{
    between: [{ field: 'group', target: 'Group' }, { field: 'member', target: 'Member' }],
    fields: [{ field: 'quantity', type: 'Number' }],
    name: 'GroupMember',
    security: { [Action.Read]: Security.Public },
  }],
})

describe('batched collection execution', () => {
  test('returns entity and record collections from one batched projection', async () => {
    await withDatabase('collection-batch', null, async database => {
      const rows = await database.query<BatchRow>('Group', {
        fields: [
          'id',
          'label',
          'members{$limit:null}',
          'members.label',
          'members.quantity',
          'entries{$limit:null}',
          'entries.quantity',
        ],
        where: { id: group },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.members.items.map(item => item.label).sort()).toEqual(['A', 'B'])
      expect(rows[0]?.members.items.map(item => item.quantity).sort()).toEqual([1, 2])
      expect(rows[0]?.entries.items.map(item => item.quantity).sort()).toEqual([1, 2])
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Group', { id: group, label: 'Group', name: 'Group' })
        await database.create('Member', [
          { id: memberA, label: 'A', name: 'A' },
          { id: memberB, label: 'B', name: 'B' },
        ])
        await database.sql`
          INSERT INTO "GroupMember" ("group.id", "member.id", "quantity")
          VALUES (${group}, ${memberA}, 1), (${group}, ${memberB}, 2)
        `
      },
    })
  })
})
