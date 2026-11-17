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

test('asOwner swaps role and exposes the same fixture context', async () => {
  await withDatabase('custom-graph-owner-api', owner, async database => {
    const appRole = await database.sql<{ role: string }[]>`
      SELECT current_role AS role
    `
    expect(appRole[0]?.role).toBe('basis_app')
    const schema = database.schema

    await database.asOwner(async ownerDatabase => {
      expect(ownerDatabase.schema).toBe(schema)
      const ownerRole = await ownerDatabase.sql<{ role: string }[]>`SELECT current_role AS role`
      expect(ownerRole[0]?.role).not.toBe('basis_app')

      await ownerDatabase.sql`CREATE TABLE "OwnerApiProof" ("id" uuid PRIMARY KEY)`
      await ownerDatabase.tx(async () => {
        await ownerDatabase.sql`INSERT INTO "OwnerApiProof" ("id") VALUES (gen_random_uuid())`
      })
      const [rolledBack] = await ownerDatabase.sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "OwnerApiProof"
      `
      expect(rolledBack?.count).toBe(0)
      await ownerDatabase.sql`DROP TABLE "OwnerApiProof"`
    })

    const restored = await database.sql<{ role: string }[]>`
      SELECT current_role AS role
    `
    expect(restored[0]?.role).toBe('basis_app')
  }, options)
})
