import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'

const owner = '00000000-0000-4000-8000-000000000601'
const editor = '00000000-0000-4000-8000-000000000602'
const ownerGroup = '00000000-0000-4000-8000-000000000603'
const editorGroup = '00000000-0000-4000-8000-000000000604'
const ownerMember = '00000000-0000-4000-8000-000000000605'
const editorMember = '00000000-0000-4000-8000-000000000606'

interface BatchItem {
  readonly id: string,
  readonly label?: string,
}

interface BatchCollection {
  readonly items: readonly BatchItem[],
}

const graph = new Graph({
  entities: [
    { fields: [], name: 'User', security: { [Action.Read]: { where: 'id = $me' } } },
    {
      fields: [
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'label', type: 'String' },
        { field: 'members', target: 'Member', type: 'Collection', via: 'GroupMember[group = @].member' },
      ],
      name: 'Group',
      security: { [Action.Read]: { where: 'owner = $me' } },
    },
    {
      fields: [
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'label', type: 'String' },
      ],
      name: 'Member',
      security: { [Action.Read]: { where: 'owner = $me' } },
    },
  ],
  relationships: [{
    between: [{ field: 'group', target: 'Group' }, { field: 'member', target: 'Member' }],
    fields: [{ field: 'quantity', type: 'Number' }],
    name: 'GroupMember',
    security: { [Action.Read]: Security.Public },
  }],
})

const options = {
  graph,
  setup: async (database: DatabaseContext) => {
    await database.create('User', [
      { id: owner, name: 'Owner' },
      { id: editor, name: 'Editor' },
    ])
    await database.create('Group', [
      { id: ownerGroup, label: 'Owner group', name: 'Owner group', owner },
      { id: editorGroup, label: 'Editor group', name: 'Editor group', owner: editor },
    ])
    await database.create('Member', [
      { id: ownerMember, label: 'Owner member', name: 'Owner member', owner },
      { id: editorMember, label: 'Editor member', name: 'Editor member', owner: editor },
    ])
    await database.sql`
      INSERT INTO "GroupMember" ("group.id", "member.id", "quantity")
      VALUES
        (${ownerGroup}, ${ownerMember}, 1),
        (${ownerGroup}, ${editorMember}, 2),
        (${editorGroup}, ${editorMember}, 3)
    `
  },
}

describe('batched collection authorization', () => {
  test('keeps owner, editor, and denied child rows isolated', async () => {
    await withDatabase('collection-auth-owner', owner, async database => {
      const rows = await database.query<{ id: string, members: BatchCollection }>('Group', {
        fields: ['id', 'members{$limit:null}', 'members.label'],
        orderBy: 'id',
      })
      expect(rows.map(row => row.id)).toEqual([ownerGroup])
      expect(rows[0]?.members.items.map(item => item.label)).toEqual(['Owner member'])
    }, options)

    await withDatabase('collection-auth-editor', editor, async database => {
      const rows = await database.query<{ id: string, members: BatchCollection }>('Group', {
        fields: ['id', 'members{$limit:null}', 'members.label'],
        orderBy: 'id',
      })
      expect(rows.map(row => row.id)).toEqual([editorGroup])
      expect(rows[0]?.members.items.map(item => item.label)).toEqual(['Editor member'])
    }, options)
  })
})
