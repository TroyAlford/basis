import { Graph } from 'basis/server'
import { withDatabase } from 'basis/testing'
import { expect, test } from 'bun:test'

const owner = '00000000-0000-4000-8000-000000000201'
const viewer = '00000000-0000-4000-8000-000000000202'
const workspace = '00000000-0000-4000-8000-000000000203'

const graph = new Graph({
  entities: [
    { fields: [], name: 'Workspace' },
    {
      fields: [{ field: 'workspace', nullable: false, target: 'Workspace', type: 'Entity' }],
      name: 'Resource',
      security: {
        create: { where: 'workspace.members $contains (id = $me and workspaceMembership.role = "owner")' },
        read: { where: 'workspace.members $contains (id = $me and workspaceMembership.role = "owner")' },
      },
    },
  ],
  relationships: [{
    between: [
      { field: 'workspace', inverse: 'members', target: 'Workspace' },
      { field: 'user', inverse: 'workspaces', target: 'User' },
    ],
    fields: [{ field: 'role', type: 'String' }],
    name: 'WorkspaceMembership',
  }],
})

const options = {
  graph,
  setup: async database => {
    await database.create('User', { id: owner, name: 'Owner' })
    await database.create('User', { id: viewer, name: 'Viewer' })
    await database.create('Workspace', { id: workspace, name: 'Workspace' })
    await database.sql`
      INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
      VALUES
        (${workspace}, ${owner}, 'owner'),
        (${workspace}, ${viewer}, 'viewer')
    `
  },
}

test('custom Graph fixtures install app-role RLS and select an actor', async () => {
  await withDatabase('custom-graph-owner', owner, async database => {
    expect(await database.create('Resource', { name: 'Owner resource', workspace }))
      .toMatchObject({ created: 1 })
  }, options)

  await expect(withDatabase('custom-graph-viewer', viewer, async database => {
    await database.create('Resource', { name: 'Viewer resource', workspace })
  }, options)).rejects.toThrow(/row-level security|authorization/i)
})
