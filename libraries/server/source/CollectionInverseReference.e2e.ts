import { withDatabase } from 'basis/testing'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { queryEntity } from './Database'
import { Action, Graph, Security } from './Graph'

setDefaultTimeout(60_000)

const person = '00000000-0000-4000-8000-000000000d01'
const profile = '00000000-0000-4000-8000-000000000d02'
const itemOne = '00000000-0000-4000-8000-000000000d03'
const itemTwo = '00000000-0000-4000-8000-000000000d04'
const owner = '00000000-0000-4000-8000-000000000d05'
const other = '00000000-0000-4000-8000-000000000d06'

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
        { cardinality: 'One', field: 'profile', inverse: 'person', target: 'Profile', type: 'Inverse' },
      ],
      name: 'Person',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'person', inverse: 'profile', target: 'Person', type: 'Entity' },
        { cardinality: 'Many', field: 'items', inverse: 'profile', target: 'Item', type: 'Inverse' },
      ],
      name: 'Profile',
      security: {
        [Action.Read]: { where: 'owner = $me' },
        [Action.Create]: Security.Public,
      },
    },
    {
      fields: [
        { field: 'label', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'profile', inverse: 'items', target: 'Profile', type: 'Entity' },
      ],
      name: 'Item',
      security: {
        [Action.Read]: { where: 'owner = $me' },
        [Action.Create]: Security.Public,
      },
    },
  ],
})

interface Collection {
  readonly $matched: number,
  readonly $total: number,
  readonly items: readonly { readonly id: string, readonly label: string }[],
}

describe('inverse reference identity', () => {
  test('uses the resolved inverse target identity for nested collections', async () => {
    await withDatabase('inverse-reference-identity', owner, async database => {
      const rows = await queryEntity<{
        readonly id: string,
        readonly profile?: { readonly id: string, readonly items: Collection },
      }>(database.sql, database.entities, 'Person', {
        fields: ['id', 'profile.id', 'profile.items{$limit:1}', 'profile.items.label'],
        where: { id: person },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.profile?.id).toBe(profile)
      expect(rows[0]?.profile?.items.items.map(item => item.id)).toEqual([itemOne])
      expect(rows[0]?.profile?.items.$matched).toBe(2)
      expect(rows[0]?.profile?.items.$total).toBe(2)
      const offset = await queryEntity<{
        readonly profile?: { readonly items: Collection },
      }>(database.sql, database.entities, 'Person', {
        fields: ['id', 'profile.items{$limit:1,$offset:1}', 'profile.items.label'],
        where: { id: person },
      })
      expect(offset[0]?.profile?.items.items.map(item => item.id)).toEqual([itemTwo])
      expect(offset[0]?.profile?.items.$matched).toBe(2)
      expect(offset[0]?.profile?.items.$total).toBe(2)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('User', [
          { id: owner, label: 'Owner', name: 'Owner' },
          { id: other, label: 'Other', name: 'Other' },
        ])
        await database.create('Person', { id: person, label: 'Person', name: 'Person' })
        await database.create('Profile', {
          id: profile,
          label: 'Profile',
          name: 'Profile',
          owner,
          person,
        })
        await database.create('Item', [
          { id: itemOne, label: 'Item One', name: 'Item One', owner, profile },
          { id: itemTwo, label: 'Item Two', name: 'Item Two', owner, profile },
          { id: '00000000-0000-4000-8000-000000000d07', label: 'Denied', name: 'Denied', owner: other, profile },
        ])
      },
    })
  })
})
