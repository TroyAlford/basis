import { expect, test } from 'bun:test'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, ADMIN_ROLE_ID, Graph, Security } from './Graph'

const graph = new Graph({
  entities: [
    { fields: [], name: 'User' },
    {
      fields: [
        { field: 'members', target: 'User', type: 'Collection', via: 'WorkspaceMembership[workspace = @].user' },
      ],
      name: 'Workspace',
    },
    {
      fields: [{ cardinality: 'Many', field: 'sections', inverse: 'document', target: 'Section', type: 'Inverse' }],
      name: 'Document',
    },
    {
      extends: 'Document',
      fields: [],
      name: 'PublicDocument',
      security: { [Action.Read]: Security.Public },
    },
    {
      extends: 'Document',
      fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
      name: 'PrivateDocument',
      security: {
        [Action.Read]: [
          { role: 'admin' },
          { where: 'workspace.members $contains (id = $me)' },
        ],
      },
    },
    {
      fields: [
        { field: 'document', inverse: 'sections', target: 'Document', type: 'Entity' },
        { field: 'title', type: 'String' },
      ],
      name: 'Section',
      security: {
        [Action.Read]: [
          { role: 'admin' },
          { where: { field: 'document', operator: '$readable' } },
        ],
      },
    },
  ],
  relationships: [{
    between: [
      { field: 'workspace', target: 'Workspace' },
      { field: 'user', target: 'User' },
    ],
    fields: [{ field: 'role', type: 'String' }],
    name: 'WorkspaceMembership',
  }],
})

const ids = {
  admin: '00000000-0000-4000-8000-000000000099',
  alice: '11111111-1111-4111-8111-111111111111',
  bob: '22222222-2222-4222-8222-222222222222',
  privateDoc: '33333333-3333-4333-8333-333333333333',
  privateSection: '44444444-4444-4444-8444-444444444444',
  publicDoc: '55555555-5555-4555-8555-555555555555',
  publicSection: '66666666-6666-4666-8666-666666666666',
  workspace: '77777777-7777-4777-8777-777777777777',
} as const

/**
 * Seed the generic public/private document fixture.
 * @param database - The trusted owner fixture context.
 */
async function setup(database: Parameters<Parameters<typeof withDatabase>[2]>[0]): Promise<void> {
  await database.create('User', [
    { id: ids.admin, name: 'Admin' },
    { id: ids.alice, name: 'Alice' },
    { id: ids.bob, name: 'Bob' },
  ])
  await database.sql`
    INSERT INTO "UserRole" ("user.id", "role.id")
    VALUES (${ids.admin}, ${ADMIN_ROLE_ID})
  `
  await database.create('Workspace', { id: ids.workspace, name: 'Workspace' })
  await database.sql`
    INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
    VALUES (${ids.workspace}, ${ids.alice}, 'editor')
  `
  await database.create('PublicDocument', { id: ids.publicDoc, name: 'Public' })
  await database.create('PrivateDocument', {
    id: ids.privateDoc,
    name: 'Private',
    workspace: ids.workspace,
  })
  await database.create('Section', [
    { document: ids.publicDoc, id: ids.publicSection, name: 'Public section', title: 'Public section' },
    { document: ids.privateDoc, id: ids.privateSection, name: 'Private section', title: 'Private section' },
  ])
}

test('authorizes sections through the referenced abstract Document read policy', async () => {
  const sectionPolicy = graph.physicalSchema('basis_app', true).policies
    .find(policy => policy.name === 'basis_Section_read')
  expect(sectionPolicy?.definition).toContain('EXISTS')
  await withDatabase('reference-visibility-anonymous', null, async database => {
    expect(await database.query('Section', {
      fields: ['id', 'title'],
      orderBy: 'id',
    })).toEqual([{ id: ids.publicSection, title: 'Public section' }])
    expect(await database.query('PublicDocument', {
      fields: ['id', 'sections', 'sections.title'],
      where: { id: ids.publicDoc },
    })).toMatchObject([{ id: ids.publicDoc, sections: { items: [{ title: 'Public section' }] } }])
  }, { graph, setup })

  await withDatabase('reference-visibility-member', ids.alice, async database => {
    expect(await database.query('Section', {
      fields: ['id', 'title'],
      orderBy: 'id',
    })).toEqual([
      { id: ids.privateSection, title: 'Private section' },
      { id: ids.publicSection, title: 'Public section' },
    ])
    expect(await database.query('PrivateDocument', {
      fields: ['id', 'sections', 'sections.title'],
      where: { id: ids.privateDoc },
    })).toMatchObject([{ id: ids.privateDoc, sections: { items: [{ title: 'Private section' }] } }])
  }, { graph, setup })

  await withDatabase('reference-visibility-admin', ids.admin, async database => {
    expect(await database.query('Section', {
      fields: ['id', 'title'],
      orderBy: 'id',
    })).toEqual([
      { id: ids.privateSection, title: 'Private section' },
      { id: ids.publicSection, title: 'Public section' },
    ])
  }, { graph, setup })

  await withDatabase('reference-visibility-stranger', ids.bob, async database => {
    expect(await database.query('Section', {
      fields: ['id', 'title'],
      orderBy: 'id',
    })).toEqual([{ id: ids.publicSection, title: 'Public section' }])
    expect(await database.query('PrivateDocument', {
      fields: ['id', 'sections'],
      where: { id: ids.privateDoc },
    })).toEqual([])
    expect(await database.sql<{ id: string }[]>`
      SELECT "id"
      FROM "Section"
      WHERE "id" = ${ids.privateSection}
    `).toEqual([])
  }, { graph, setup })
})
