import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DatabaseTestOptions } from '../testing/DatabaseFixture'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'

setDefaultTimeout(60_000)

const owner = randomUUID()
const outsider = randomUUID()
const workspace = randomUUID()
const document = randomUUID()
const art = randomUUID()

const graph = new Graph({
  entities: [
    { fields: [], name: 'User', security: { [Action.Read]: { where: 'id = $me' } } },
    { fields: [], name: 'Workspace', security: { [Action.Read]: Security.Public } },
    {
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'backup', nullable: true, target: 'Art', type: 'Entity' },
      ],
      name: 'Document',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
      name: 'Art',
      security: { [Action.Read]: { where: 'owner = $me' } },
    },
  ],
})

const options: DatabaseTestOptions = {
  graph,
  setup: async database => {
    await database.create('User', { id: owner, name: 'Owner' })
    await database.create('User', { id: outsider, name: 'Outsider' })
    await database.create('Workspace', { id: workspace, name: 'Shared' })
    await database.create('Art', { id: art, name: 'Private art', owner })
    await database.create('Document', {
      backup: art,
      id: document,
      name: 'Document',
      workspace,
    })
  },
}

test('preserves an optional concrete reference when its target is inaccessible', async () => {
  await withDatabase('concrete-identity-optional', outsider, async database => {
    expect(await database.query('Document', {
      fields: ['id', 'workspace.name', 'backup.name'],
      where: { id: document },
    })).toEqual([{
      backup: null,
      id: document,
      workspace: { entity: 'Workspace', id: workspace, name: 'Shared' },
    }])
  }, options)
})

test('resolves the inherited name and optional target for an authorized reader', async () => {
  await withDatabase('concrete-identity-owner', owner, async database => {
    expect(await database.query('Document', {
      fields: ['id', 'workspace.name', 'backup.name'],
      where: { id: document },
    })).toEqual([{
      backup: { entity: 'Art', id: art, name: 'Private art' },
      id: document,
      workspace: { entity: 'Workspace', id: workspace, name: 'Shared' },
    }])
  }, options)
})
