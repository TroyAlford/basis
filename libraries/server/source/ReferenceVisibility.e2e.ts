import { expect, test } from 'bun:test'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, ADMIN_ROLE_ID, Graph, Security } from './Graph'

const graph = new Graph({
  entities: [
    { fields: [], name: 'User', security: { [Action.Read]: Security.Public } },
    {
      fields: [
        { field: 'members', target: 'User', type: 'Collection', via: 'WorkspaceMembership[workspace = @].user' },
      ],
      name: 'Workspace',
      security: { [Action.Read]: Security.Public },
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
    security: { [Action.Read]: Security.Public },
  }],
})

const ids = {
  admin: '00000000-0000-4000-8000-000000000099',
  alice: '11111111-1111-4111-8111-111111111111',
  bob: '22222222-2222-4222-8222-222222222222',
  emptyDoc: '88888888-8888-4888-8888-888888888888',
  emptySection: '99999999-9999-4999-8999-999999999999',
  emptyWorkspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orphanSection: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
  await database.create('Workspace', [
    { id: ids.emptyWorkspace, name: 'Empty Workspace' },
    { id: ids.workspace, name: 'Workspace' },
  ])
  await database.sql`
    INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
    VALUES (${ids.workspace}, ${ids.alice}, 'editor')
  `
  await database.create('PublicDocument', { code: 'shared', id: ids.publicDoc, name: 'Public' })
  await database.create('PrivateDocument', [
    {
      code: 'shared',
      id: ids.privateDoc,
      name: 'Private',
      workspace: ids.workspace,
    },
    {
      code: 'empty',
      id: ids.emptyDoc,
      name: 'Empty',
      workspace: ids.emptyWorkspace,
    },
  ])
  await database.create('Section', [
    { document: ids.publicDoc, id: ids.publicSection, name: 'Public section', title: 'Public section' },
    { document: ids.privateDoc, id: ids.privateSection, name: 'Private section', title: 'Private section' },
    { document: ids.emptyDoc, id: ids.emptySection, name: 'Empty section', title: 'Empty section' },
    { document: null, id: ids.orphanSection, name: 'Orphan section', title: 'Orphan section' },
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
    expect(await database.query('Section', {
      fields: ['id'],
      where: 'document.workspace.members $contains (id = $me)',
    })).toEqual([])
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: "document.entity = 'PublicDocument'",
    })).toEqual([{ id: ids.publicSection }])
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
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: 'document.workspace.members $contains (id = $me)',
    })).toEqual([{ id: ids.privateSection }])
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: "document.code = 'shared'",
    })).toEqual([
      { id: ids.privateSection },
      { id: ids.publicSection },
    ])
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: "document.entity = 'PublicDocument'",
    })).toEqual([{ id: ids.publicSection }])
  }, { graph, setup })

  await withDatabase('reference-visibility-admin', ids.admin, async database => {
    expect(await database.query('Section', {
      fields: ['id', 'title'],
      orderBy: 'id',
    })).toEqual([
      { id: ids.privateSection, title: 'Private section' },
      { id: ids.publicSection, title: 'Public section' },
      { id: ids.emptySection, title: 'Empty section' },
      { id: ids.orphanSection, title: 'Orphan section' },
    ])
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: 'document.workspace.members $empty',
    })).toEqual([{ id: ids.emptySection }])
    expect(await database.query('Section', {
      fields: ['id'],
      orderBy: 'id',
      where: "document.code = 'shared'",
    })).toEqual([
      { id: ids.privateSection },
      { id: ids.publicSection },
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
    expect(await database.query('Section', {
      fields: ['id'],
      where: 'document.workspace.members $contains (id = $me)',
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

test('compiles the descendant traversal with concrete guards and owner correlation', () => {
  const schema = siblingGraph.physicalSchema('basis_app', true)
  const helper = schema.functions.find(fn => (
    fn.name.startsWith('policy_')
    && fn.sql.includes('PrivateDocument')
    && fn.sql.includes('SiblingMembership')
  ))
  expect(helper).toBeDefined()
  expect(helper?.sql).toContain('"SiblingPublicDocument"')
  expect(helper?.sql).toContain('"SiblingPrivateDocument"')
  expect(helper?.sql).toContain('"SiblingMembership"')
  expect(helper?.sql).toContain('"workspace.id"')
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

const siblingGraph = new Graph({
  entities: [
    { fields: [], name: 'User', security: { [Action.Read]: Security.Public } },
    {
      fields: [
        { field: 'members', target: 'User', type: 'Collection', via: 'SiblingMembership[workspace = @].user' },
      ],
      name: 'Workspace',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        {
          cardinality: 'Many',
          field: 'sections',
          inverse: 'document',
          target: 'SiblingDocumentSection',
          type: 'Inverse',
        },
      ],
      name: 'SiblingDocument',
    },
    {
      extends: 'SiblingDocument',
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'code', type: 'String' },
      ],
      name: 'SiblingPublicDocument',
      security: { [Action.Read]: Security.Public },
    },
    {
      extends: 'SiblingDocument',
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'code', type: 'String' },
      ],
      name: 'SiblingPrivateDocument',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [
        { field: 'document', inverse: 'sections', target: 'SiblingDocument', type: 'Entity' },
        { field: 'title', type: 'String' },
      ],
      name: 'SiblingDocumentSection',
      security: {
        [Action.Read]: [
          { role: 'admin' },
          { where: 'document.workspace.members $contains (id = $me)' },
        ],
      },
    },
  ],
  relationships: [{
    between: [
      { field: 'workspace', target: 'Workspace' },
      { field: 'user', target: 'User' },
    ],
    fields: [],
    name: 'SiblingMembership',
    security: { [Action.Read]: Security.Public },
  }],
})

const siblingIds = {
  alice: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  privateDoc: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  privateSection: '11111111-aaaa-4aaa-8aaa-111111111111',
  privateWorkspace: '33333333-cccc-4ccc-8ccc-333333333333',
  publicDoc: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  publicSection: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  publicWorkspace: '22222222-bbbb-4bbb-8bbb-222222222222',
} as const

/**
 * Seed two concrete documents whose compatible Workspace references have
 * different physical owners and different memberships.
 * @param database - Trusted fixture context.
 */
async function setupSiblings(database: Parameters<Parameters<typeof withDatabase>[2]>[0]): Promise<void> {
  await database.create('User', { id: siblingIds.alice, name: 'Alice' })
  await database.create('Workspace', [
    { id: siblingIds.privateWorkspace, name: 'Private workspace' },
    { id: siblingIds.publicWorkspace, name: 'Public workspace' },
  ])
  await database.sql`
    INSERT INTO "SiblingMembership" ("workspace.id", "user.id")
    VALUES (${siblingIds.publicWorkspace}, ${siblingIds.alice}), (${siblingIds.privateWorkspace}, ${siblingIds.alice})
  `
  await database.create('SiblingPublicDocument', {
    code: 'shared',
    id: siblingIds.publicDoc,
    name: 'Public document',
    workspace: siblingIds.publicWorkspace,
  })
  await database.create('SiblingPrivateDocument', {
    code: 'shared',
    id: siblingIds.privateDoc,
    name: 'Private document',
    workspace: siblingIds.privateWorkspace,
  })
  await database.create('SiblingDocumentSection', [
    { document: siblingIds.publicDoc, id: siblingIds.publicSection, name: 'Public', title: 'Public' },
    { document: siblingIds.privateDoc, id: siblingIds.privateSection, name: 'Private', title: 'Private' },
  ])
}

test('resolves compatible sibling reference owners in queries and policy', async () => {
  await withDatabase('reference-visibility-sibling-owners', siblingIds.alice, async database => {
    expect(await database.query('SiblingDocumentSection', {
      fields: ['id'],
      orderBy: 'id',
      where: 'document.workspace.members $contains (id = $me)',
    })).toEqual([
      { id: siblingIds.privateSection },
      { id: siblingIds.publicSection },
    ])
    expect(await database.query('SiblingDocumentSection', {
      fields: ['id'],
      orderBy: 'id',
    })).toEqual([
      { id: siblingIds.privateSection },
      { id: siblingIds.publicSection },
    ])
  }, { graph: siblingGraph, setup: setupSiblings })
})
