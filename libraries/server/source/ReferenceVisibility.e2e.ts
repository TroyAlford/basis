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
      fields: [{ field: 'code', type: 'String' }],
      name: 'PublicDocument',
      security: { [Action.Read]: Security.Public },
    },
    {
      extends: 'Document',
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'code', type: 'String' },
      ],
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
          { where: "document.entity = 'PublicDocument'" },
          { where: 'document.workspace.members $contains (id = $me)' },
        ],
      },
    },
    {
      fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
      name: 'SiblingSection',
      security: {
        [Action.Read]: { where: "document.code = 'shared'" },
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
  await database.create('PublicDocument', { code: 'shared', id: ids.publicDoc, name: 'Public' })
  await database.create('PrivateDocument', {
    code: 'shared',
    id: ids.privateDoc,
    name: 'Private',
    workspace: ids.workspace,
  })
  await database.create('Section', [
    { document: ids.publicDoc, id: ids.publicSection, name: 'Public section', title: 'Public section' },
    { document: ids.privateDoc, id: ids.privateSection, name: 'Private section', title: 'Private section' },
  ])
  await database.create('SiblingSection', [
    { document: ids.publicDoc, id: '77777777-1111-4111-8111-777777777777', name: 'Sibling public' },
    { document: ids.privateDoc, id: '77777777-2222-4222-8222-777777777777', name: 'Sibling private' },
  ])
}

test('authorizes sections through the referenced abstract Document read policy', async () => {
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

test('resolves compatible sibling descendant fields through the same path model', async () => {
  await withDatabase('reference-visibility-siblings', ids.alice, async database => {
    expect(await database.query('SiblingSection', {
      fields: ['id', 'name'],
      orderBy: 'id',
    })).toEqual([
      { id: '77777777-1111-4111-8111-777777777777', name: 'Sibling public' },
      { id: '77777777-2222-4222-8222-777777777777', name: 'Sibling private' },
    ])
  }, { graph, setup })
})

test('rejects incompatible sibling descendant declarations in a policy path', () => {
  expect(() => new Graph({
    entities: [
      { fields: [], name: 'Document' },
      {
        extends: 'Document',
        fields: [{ field: 'code', type: 'String' }],
        name: 'PublicDocument',
      },
      {
        extends: 'Document',
        fields: [{ field: 'code', type: 'Number' }],
        name: 'PrivateDocument',
      },
      {
        fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
        name: 'Section',
        security: { [Action.Read]: { where: "document.code = 'shared'" } },
      },
    ],
  })).toThrow(/incompatible declarations/)
})
