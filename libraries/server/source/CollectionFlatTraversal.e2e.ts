import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'

const a = '00000000-0000-4000-8000-000000000a01'
const b = '00000000-0000-4000-8000-000000000a02'
const c = '00000000-0000-4000-8000-000000000a03'

const graph = new Graph({
  entities: [{
    fields: [
      { field: 'label', type: 'String' },
      { field: 'following', target: 'Person', type: 'Collection', via: 'Follow[follower = @].followed' },
      { field: 'followers', target: 'Person', type: 'Collection', via: 'Follow[followed = @].follower' },
    ],
    name: 'Person',
    security: { [Action.Read]: Security.Public },
  }],
  relationships: [{
    between: [{ field: 'follower', target: 'Person' }, { field: 'followed', target: 'Person' }],
    fields: [],
    name: 'Follow',
    security: { [Action.Read]: Security.Public },
  }],
})

describe('flat collection traversal direction', () => {
  test('does not reuse an outgoing source for the reverse navigation', async () => {
    await withDatabase('flat-traversal', null, async database => {
      const rows = await database.query<{
        readonly followers: { readonly items: readonly { readonly label: string }[] },
        readonly following: { readonly items: readonly { readonly label: string }[] },
      }>('Person', {
        fields: ['id', 'following{$limit:null}', 'following.label', 'followers{$limit:null}', 'followers.label'],
        where: { id: a },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.following.items.map(person => person.label)).toEqual(['B'])
      expect(rows[0]?.followers.items.map(person => person.label)).toEqual(['C'])
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Person', [
          { id: a, label: 'A', name: 'A' },
          { id: b, label: 'B', name: 'B' },
          { id: c, label: 'C', name: 'C' },
        ])
        await database.sql`
          INSERT INTO "Follow" ("follower.id", "followed.id")
          VALUES (${a}, ${b}), (${c}, ${a})
        `
      },
    })
  })
})
