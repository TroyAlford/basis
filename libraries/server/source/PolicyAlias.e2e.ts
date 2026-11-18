import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, ADMIN_ROLE_ID, Graph, Security } from './Graph'

const publicEntity = {
  [Action.Read]: Security.Public,
  [Action.Create]: Security.Public,
  [Action.Update]: Security.Public,
  [Action.Delete]: Security.Public,
} as const

const graph = new Graph({
  entities: [
    { fields: [], name: 'User', security: publicEntity },
    {
      fields: [
        { field: 'members', target: 'User', type: 'Collection', via: 'WorkspaceMembership[workspace = @].user' },
      ],
      name: 'Workspace',
      security: publicEntity,
    },
    {
      fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
      name: 'Printing',
      security: publicEntity,
    },
    {
      fields: [
        { field: 'printing', target: 'Printing', type: 'Entity' },
        { field: 'backupPrinting', target: 'Printing', type: 'Entity' },
      ],
      name: 'Panel',
      security: publicEntity,
    },
    { fields: [], name: 'Face', security: publicEntity },
  ],
  relationships: [
    {
      between: [
        { field: 'workspace', target: 'Workspace' },
        { field: 'user', target: 'User' },
      ],
      fields: [{ field: 'role', type: 'String' }],
      name: 'WorkspaceMembership',
      security: publicEntity,
    },
    {
      between: [
        { field: 'panel', target: 'Panel' },
        { field: 'face', target: 'Face' },
      ],
      fields: [{ field: 'position', type: 'Number' }],
      name: 'PanelFace',
    },
  ],
  security: {
    PanelFace: {
      [Action.Read]: [
        { role: 'admin' },
        {
          where: '(panel.printing.workspace.members $contains (id = $me) $or ' +
            'panel.backupPrinting.workspace.members $contains (id = $me))',
        },
      ],
      [Action.Create]: { role: 'admin' },
      [Action.Update]: { role: 'admin' },
      [Action.Delete]: { role: 'admin' },
    },
  },
})

test('installs nested member-read and administrator-write policies', async () => {
  const first = graph.physicalSchema('basis_app', true)
  const second = graph.physicalSchema('basis_app', true)
  expect(second).toEqual(first)
  await withDatabase('policy-alias-nested', null, async database => {
    const policies = await database.sql<{ name: string }[]>`
      SELECT policyname AS name
      FROM pg_policies
      WHERE schemaname = CURRENT_SCHEMA() AND tablename = 'PanelFace'
      ORDER BY policyname
    `
    expect(policies.map(policy => policy.name)).toEqual([
      'basis_PanelFace_create',
      'basis_PanelFace_delete',
      'basis_PanelFace_read',
      'basis_PanelFace_update',
    ])
  }, { graph })
})

test('keeps member SELECT and administrator writes separate on a composite relationship', async () => {
  const member = randomUUID()
  const admin = randomUUID()
  const workspace = randomUUID()
  const otherWorkspace = randomUUID()
  const printing = randomUUID()
  const otherPrinting = randomUUID()
  const panel = randomUUID()
  const panel2 = randomUUID()
  const face = randomUUID()
  const face2 = randomUUID()
  const seed = async (database: Parameters<Parameters<typeof withDatabase>[2]>[0]): Promise<void> => {
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${member}, 'Member', 'User'),
        (${admin}, 'Admin', 'User'),
        (${workspace}, 'Workspace', 'Workspace'),
        (${otherWorkspace}, 'Other Workspace', 'Workspace'),
        (${printing}, 'Printing', 'Printing'),
        (${otherPrinting}, 'Other Printing', 'Printing'),
        (${panel}, 'Panel', 'Panel'),
        (${panel2}, 'Panel 2', 'Panel'),
        (${face}, 'Face', 'Face'),
        (${face2}, 'Face 2', 'Face')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES (${member}), (${admin})
    `
    await database.sql`
      INSERT INTO "Workspace" ("id")
      VALUES (${workspace}), (${otherWorkspace})
    `
    await database.sql`
      INSERT INTO "Printing" ("id", "workspace.id")
      VALUES (${printing}, ${workspace}), (${otherPrinting}, ${otherWorkspace})
    `
    await database.sql`
      INSERT INTO "Panel" ("id", "printing.id", "backupPrinting.id")
      VALUES
        (${panel}, ${printing}, ${otherPrinting}),
        (${panel2}, ${otherPrinting}, ${printing})
    `
    await database.sql`
      INSERT INTO "Face" ("id")
      VALUES (${face}), (${face2})
    `
    await database.sql`
      INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
      VALUES (${workspace}, ${member}, 'member')
    `
    await database.sql`
      INSERT INTO "UserRole" ("user.id", "role.id")
      VALUES (${admin}, ${ADMIN_ROLE_ID})
    `
  }

  await withDatabase('policy-alias-admin-and-member', admin, async database => {
    await database.sql`
      INSERT INTO "PanelFace" ("panel.id", "face.id", "position")
      VALUES (${panel}, ${face}, 0), (${panel2}, ${face2}, 0)
    `

    await database.sql`
      SELECT SET_CONFIG('actor.id', ${member}, TRUE)
    `
    expect(await database.sql<{ position: number }[]>`
      SELECT "position"
      FROM "PanelFace"
      ORDER BY "panel.id"
    `).toHaveLength(2)
    expect(await database.sql<{ position: number }[]>`
      UPDATE "PanelFace"
      SET "position" = 9
      WHERE "panel.id" = ${panel} AND "face.id" = ${face}
      RETURNING "position"
    `).toEqual([])

    await database.sql`
      SELECT SET_CONFIG('actor.id', ${admin}, TRUE)
    `
    await database.sql`
      INSERT INTO "PanelFace" ("panel.id", "face.id", "position")
      VALUES (${panel}, ${face2}, 1)
    `
    expect(await database.sql<{ position: number }[]>`
      UPDATE "PanelFace"
      SET "position" = 2
      WHERE "panel.id" = ${panel} AND "face.id" = ${face2}
      RETURNING "position"
    `).toEqual([{ position: 2 }])
    expect(await database.sql<{ position: number }[]>`
      DELETE FROM "PanelFace"
      WHERE "panel.id" = ${panel} AND "face.id" = ${face2}
      RETURNING "position"
    `).toEqual([{ position: 2 }])
  }, { graph, setup: seed })
})
