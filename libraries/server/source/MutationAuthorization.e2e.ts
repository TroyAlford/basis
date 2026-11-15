import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { runAsActor } from './ActorContext'
import { openAdmin } from './Database'
import { Constraint } from './EntityDefinitions'
import { Action, Graph, Security } from './Graph'
import { MutationError } from './Mutation'
import { Operator } from './Operator'
import { Server } from './Server'

const silent = new Logger({ silent: true })

/** Numeric limits used by the authorization fixtures. */
enum Limit {
  Delete = 40,
  DeleteAction = 90,
  Read = 30,
  Update = 70,
}

/** Score bounds used by the authorization fixtures. */
enum Score {
  Maximum = 10,
  Minimum = 0,
}

/** Relationship membership role used by the where-only fixture. */
enum MembershipRole {
  Owner = 'Owner',
}

/**
 * Build a canonical comparison filter.
 * @param field - Field name.
 * @param operator - Closed comparison operator.
 * @param value - Comparison value.
 * @returns The structured filter.
 */
function compare(field: string, operator: Operator.Comparison, value: unknown) {
  return { field, operator, value }
}

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    {
      fields: [
        { field: 'owner', target: 'User', type: 'Entity' },
        { field: 'rank', type: 'Number' },
        { field: 'score', maximum: Score.Maximum, minimum: Score.Minimum, type: 'Number' },
        { field: 'title', type: 'String' },
      ],
      name: 'Article',
      security: {
        [Action.Read]: Security.Public,
        [Action.Create]: [
          { role: 'admin' },
          { role: 'creator', where: compare('score', Operator.Comparison.GreaterThanOrEqual, Score.Minimum) },
        ],
        [Action.Update]: [
          { role: 'admin' },
          { role: 'updater', where: compare('rank', Operator.Comparison.LessThan, Limit.Update) },
        ],
        [Action.Delete]: [
          { role: 'admin' },
          { role: 'deleter', where: compare('rank', Operator.Comparison.LessThan, Limit.Delete) },
        ],
      },
    },
  ],
  roles: {
    creator: { name: 'Creator' },
    deleter: { name: 'Deleter' },
    updater: { name: 'Updater' },
  },
  security: {
    ExternalIdentity: { [Action.Manage]: { role: 'admin' } },
    Role: { [Action.Manage]: { role: 'admin' } },
    UserRole: { [Action.Manage]: { role: 'admin' } },
  },
})

const readGateGraph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    {
      fields: [
        { field: 'rank', type: 'Number' },
        { field: 'score', maximum: Score.Maximum, minimum: Score.Minimum, type: 'Number' },
        { field: 'title', type: 'String' },
      ],
      name: 'Draft',
      security: {
        [Action.Read]: [
          { role: 'admin' },
          { role: 'reader', where: compare('rank', Operator.Comparison.LessThan, Limit.Read) },
        ],
        [Action.Create]: [
          { role: 'admin' },
          { role: 'creator', where: compare('score', Operator.Comparison.GreaterThanOrEqual, Score.Minimum) },
        ],
        [Action.Update]: [
          { role: 'admin' },
          { role: 'updater', where: compare('rank', Operator.Comparison.LessThan, Limit.Update) },
        ],
        [Action.Delete]: [
          { role: 'admin' },
          { role: 'deleter', where: compare('rank', Operator.Comparison.LessThan, Limit.DeleteAction) },
        ],
      },
    },
    {
      fields: [{ field: 'title', type: 'String' }],
      name: 'Workspace',
      security: {
        [Action.Read]: [
          { role: 'admin' },
          {
            where: {
              field: 'members',
              filters: [compare('id', Operator.Comparison.Equal, '$me')],
              operator: Operator.Comparison.Contains,
            },
          },
        ],
        [Action.Create]: { role: 'admin' },
        [Action.Update]: {
          where: {
            field: 'members',
            filters: [
              {
                filters: [
                  compare('id', Operator.Comparison.Equal, '$me'),
                  compare('workspaceMembership.role', Operator.Comparison.Equal, MembershipRole.Owner),
                ],
                operator: Operator.Logical.And,
              },
            ],
            operator: Operator.Comparison.Contains,
          },
        },
        [Action.Delete]: { role: 'admin' },
      },
    },
    { extends: 'Workspace', fields: [{ field: 'code', type: 'String' }], name: 'Project' },
  ],
  relationships: [{
    between: [
      { field: 'workspace', inverse: 'members', target: 'Workspace' },
      { field: 'user', inverse: 'workspaces', target: 'User' },
    ],
    fields: [{ field: 'role', type: 'String' }],
    name: 'WorkspaceMembership',
    security: {
      [Action.Create]: { role: 'admin' },
      [Action.Delete]: { role: 'admin' },
      [Action.Read]: { role: 'admin' },
      [Action.Update]: { role: 'admin' },
    },
  }],
  roles: {
    creator: { name: 'Creator' },
    deleter: { name: 'Deleter' },
    reader: { name: 'Reader' },
    updater: { name: 'Updater' },
  },
  security: {
    ExternalIdentity: { [Action.Manage]: { role: 'admin' } },
    Role: { [Action.Manage]: { role: 'admin' } },
    UserRole: { [Action.Manage]: { role: 'admin' } },
  },
})

/**
 * Start one isolated authorization server with a mutation graph.
 * @param install - Temporary installation root.
 * @param applicationGraph - Graph to install for the server.
 * @returns The started server.
 */
async function start(install: string, applicationGraph: Graph): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(applicationGraph)
    .database()
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  try {
    await server.ready()
  } finally {
    process.chdir(previous)
  }
  const admin = await openAdmin(server.db)
  try {
    await installSchema(admin.sql, applicationGraph, {
      appRole: 'basis_app',
      schema: 'public',
      superuser: true,
      version: `mutation-authorization-${randomUUID()}`,
    })
  } finally {
    await admin.close()
  }
  return server
}

/**
 * Bootstrap an administrator and assign roles to one enrolled worker.
 * @param server - Started server.
 * @param roleNames - Roles assigned to the worker.
 * @returns The administrator and worker identities.
 */
async function bootstrapActors(
  server: Server,
  roleNames: readonly string[],
): Promise<{ readonly admin: string, readonly worker: string }> {
  const authorization = server.auth
  if (!authorization) throw new Error('authorization did not initialize')
  const asActor = <T>(actor: string | null, work: () => T): T => runAsActor({ id: actor }, work)
  const admin = await authorization.bootstrap({
    displayName: 'Admin',
    email: 'admin@example.com',
    provider: 'test',
    subject: 'admin',
  })
  if (!admin.userId) throw new Error('bootstrap did not create an administrator')
  const worker = await authorization.enrollIdentity('test', 'worker', {
    email: 'worker@example.com',
  })
  if (!worker) throw new Error('worker was not enrolled')
  for (const name of roleNames) {
    const details = authorization.graph.role(name)
    if (!details) throw new Error(`role "${name}" was not loaded`)
    await asActor(admin.userId, () => authorization.assignRole(worker, details.id))
  }
  return { admin: admin.userId, worker }
}

describe('Graph mutation authorization', () => {
  test('selects READ-visible candidates and counts only writes passing READ plus the specific action', async () => {
    const install = tempDirectory('basis-mutation-authorization-')
    const server = await start(install, graph)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const asActor = <T>(actor: string | null, work: () => T): T => runAsActor({ id: actor }, work)
      const { admin, worker } = await bootstrapActors(server, ['updater', 'deleter'])
      const updater = graph.role('updater')
      const deleter = graph.role('deleter')
      const creator = graph.role('creator')
      if (!updater || !deleter || !creator) throw new Error('roles were not loaded')

      expect(await asActor(admin, () => server.db.create('Article', Array.from(
        { length: 100 },
        (_value, rank) => ({
          name: `Article ${rank}`,
          rank,
          score: 5,
          title: `Article ${rank}`,
        }),
      )))).toEqual({ created: 100 })
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(100)

      const scoreFive = compare('score', Operator.Comparison.Equal, 5)
      const ambiguous = await asActor(worker, () => server.db.upsert(
        'Article',
        scoreFive,
        { name: 'Ambiguous', rank: 200, score: 5, title: 'Ambiguous' },
      )).catch((error: unknown) => error)
      expect(ambiguous).toBeInstanceOf(MutationError)
      expect((ambiguous as MutationError).code).toBe('cardinality')
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(100)

      expect(await asActor(worker, () => server.db.edit(
        'Article',
        scoreFive,
        { score: 6 },
      ))).toEqual({ edited: 70 })
      const edited = await asActor(worker, () => server.db.query<{
        rank: number,
        score: number,
      }>('Article', { fields: ['rank', 'score'], limit: null, orderBy: 'rank' }))
      expect(edited.filter(row => row.score === 6)).toHaveLength(70)
      expect(edited.filter(row => row.score === 5)).toHaveLength(30)
      expect(edited.filter(row => row.rank < Limit.Update && row.score === 6)).toHaveLength(70)

      expect(await asActor(worker, () => server.db.delete(
        'Article',
        compare('score', Operator.Comparison.Equal, 6),
      ))).toEqual({ deleted: 40 })
      expect(await asActor(worker, () => server.db.query('Article', { fields: ['id'], limit: null })))
        .toHaveLength(60)

      const denied = await asActor(worker, () => server.db.create('Article', {
        name: 'Denied',
        rank: 5,
        score: 5,
        title: 'Denied',
      })).catch((error: unknown) => error)
      expect(denied).toBeInstanceOf(MutationError)
      expect((denied as MutationError).code).toBe('authorization')

      await asActor(admin, () => authorization.assignRole(worker, creator.id))
      const created = await asActor(worker, () => server.db.create('Article', {
        name: 'Created',
        rank: 5,
        score: 5,
        title: 'Created',
      }))
      expect(created).toMatchObject({
        created: 1,
        record: { entity: 'Article', id: expect.any(String), title: 'Created' },
      })

      const upsertCreated = await asActor(worker, () => server.db.upsert(
        'Article',
        compare('rank', Operator.Comparison.Equal, 200),
        { name: 'Upserted', rank: 200, score: 1, title: 'Upserted' },
      ))
      expect(upsertCreated).toMatchObject({
        created: 1,
        edited: 0,
        record: { rank: 200, title: 'Upserted' },
      })
      expect(await asActor(worker, () => server.db.upsert(
        'Article',
        compare('rank', Operator.Comparison.Equal, 50),
        { score: 2 },
      ))).toMatchObject({ created: 0, edited: 1, record: { score: 2 } })
      const readOnly = compare('rank', Operator.Comparison.Equal, 80)
      const nonmatching = await asActor(worker, () => server.db.upsert(
        'Article',
        readOnly,
        { name: 'Read only', rank: 81, score: 2, title: 'Read only' },
      )).catch((error: unknown) => error)
      expect(nonmatching).toBeInstanceOf(MutationError)
      expect((nonmatching as MutationError).code).toBe('operation')
      expect(await asActor(worker, () => server.db.query<{
        rank: number,
        score: number,
      }>('Article', {
        fields: ['rank', 'score'],
        limit: null,
        where: readOnly,
      }))).toEqual([{ rank: 80, score: 5 }])
      expect(await asActor(worker, () => server.db.upsert(
        'Article',
        readOnly,
        { name: 'Read only', rank: 80, score: 2, title: 'Read only' },
      ))).toMatchObject({ created: 1, edited: 0, record: { rank: 80, score: 2 } })
      const rows = await asActor(worker, () => server.db.query<{
        rank: number,
        score: number,
      }>('Article', {
        fields: ['rank', 'score'],
        limit: null,
        orderBy: 'score',
        where: readOnly,
      }))
      expect(rows).toEqual([
        { rank: 80, score: 2 },
        { rank: 80, score: 5 },
      ])
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)

  test('requires READ before writes, checks new rows, and honors inherited membership security', async () => {
    const install = tempDirectory('basis-mutation-read-gate-')
    const server = await start(install, readGateGraph)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const asActor = <T>(actor: string | null, work: () => T): T => runAsActor({ id: actor }, work)
      const { admin, worker } = await bootstrapActors(
        server,
        ['creator', 'deleter', 'reader', 'updater'],
      )
      await asActor(admin, () => server.db.create('Draft', [
        { name: 'Readable', rank: 10, score: 5, title: 'Readable' },
        { name: 'Hidden action', rank: 50, score: 5, title: 'Hidden action' },
        { name: 'Hidden create', rank: 80, score: 5, title: 'Hidden create' },
      ]))
      expect(await asActor(worker, () => server.db.query('Draft', { fields: ['id'], limit: null })))
        .toHaveLength(1)

      expect(await asActor(worker, () => server.db.edit(
        'Draft',
        compare('rank', Operator.Comparison.GreaterThanOrEqual, 0),
        { title: 'Edited' },
      ))).toMatchObject({ edited: 1, record: { title: 'Edited' } })
      expect(await asActor(worker, () => server.db.delete(
        'Draft',
        compare('rank', Operator.Comparison.Equal, 50),
      ))).toEqual({ deleted: 0 })
      const stillPresent = await asActor(admin, () => server.db.query<{ rank: number }>('Draft', {
        fields: ['rank'],
        limit: null,
        where: compare('rank', Operator.Comparison.Equal, 50),
      }))
      expect(stillPresent).toEqual([{ rank: 50 }])

      const deniedCreate = await asActor(worker, () => server.db.create('Draft', {
        name: 'No read',
        rank: 80,
        score: 5,
        title: 'No read',
      })).catch((error: unknown) => error)
      expect(deniedCreate).toBeInstanceOf(MutationError)
      expect((deniedCreate as MutationError).code).toBe('authorization')
      expect(await asActor(admin, () => server.db.query('Draft', { fields: ['id'], limit: null })))
        .toHaveLength(3)

      expect(await asActor(worker, () => server.db.create('Draft', {
        name: 'Readable create',
        rank: 10,
        score: 5,
        title: 'Readable create',
      }))).toMatchObject({
        created: 1,
        record: { entity: 'Draft', rank: 10, title: 'Readable create' },
      })

      const readable = await asActor(admin, () => server.db.query<{ id: string }>('Draft', {
        fields: ['id'],
        limit: null,
        where: compare('rank', Operator.Comparison.Equal, 10),
      }))
      expect(readable).toHaveLength(2)
      const first = readable[0]
      if (!first) throw new Error('Readable draft was not created')
      const changedRead = await asActor(worker, () => server.db.edit(
        'Draft',
        compare('id', Operator.Comparison.Equal, first.id),
        { rank: 80 },
      )).catch((error: unknown) => error)
      expect(changedRead).toBeInstanceOf(MutationError)
      expect((changedRead as MutationError).code).toBe('authorization')
      expect(await asActor(admin, () => server.db.query('Draft', {
        fields: ['rank'],
        limit: null,
        where: compare('id', Operator.Comparison.Equal, first.id),
      }))).toEqual([{ rank: 10 }])

      await asActor(admin, () => server.db.create('Project', [
        { code: 'A', name: 'Member project', title: 'Member project' },
        { code: 'B', name: 'Other project', title: 'Other project' },
      ]))
      const projects = await asActor(admin, () => server.db.query<{ code: string, id: string }>('Project', {
        fields: ['id', 'code'],
        limit: null,
        orderBy: 'code',
      }))
      expect(projects).toHaveLength(2)
      const [memberProject, otherProject] = projects
      if (!memberProject || !otherProject) throw new Error('Projects were not created')
      await asActor(admin, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
          VALUES (${memberProject.id}, ${worker}, ${MembershipRole.Owner})
        `
      }))

      expect(await asActor(worker, () => server.db.edit(
        'Project',
        compare('id', Operator.Comparison.Equal, memberProject.id),
        { title: 'Member updated' },
      ))).toMatchObject({
        edited: 1,
        record: { code: 'A', entity: 'Project', title: 'Member updated' },
      })
      expect(await asActor(worker, () => server.db.edit(
        'Project',
        compare('id', Operator.Comparison.Equal, otherProject.id),
        { title: 'Other updated' },
      ))).toEqual({ edited: 0 })
      expect(await asActor(admin, () => server.db.query<{ id: string, title: string }>('Project', {
        fields: ['id', 'title'],
        limit: null,
        orderBy: 'code',
      }))).toEqual([
        { id: memberProject.id, title: 'Member updated' },
        { id: otherProject.id, title: 'Other project' },
      ])
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)

  test('validates named relationship edges and multi-hop entity constraints in db.tx', async () => {
    const publicActions = {
      [Action.Create]: Security.Public,
      [Action.Delete]: Security.Public,
      [Action.Read]: Security.Public,
      [Action.Update]: Security.Public,
    }
    const edgeGraph = new Graph({
      entities: [
        { fields: [], name: 'User', security: publicActions },
        {
          fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
          name: 'Asset',
          security: publicActions,
        },
        {
          fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
          name: 'Document',
          security: publicActions,
        },
        {
          fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
          name: 'Section',
          security: publicActions,
        },
        {
          constraints: [{
            description: 'The section document and asset must share an owner.',
            name: 'sameOwnerPath',
            type: Constraint.Validation,
            where: 'section.document.owner = asset.owner',
          }],
          fields: [
            { field: 'asset', target: 'Asset', type: 'Entity' },
            { field: 'section', target: 'Section', type: 'Entity' },
          ],
          name: 'Anchor',
          security: publicActions,
        },
      ],
      relationships: [{
        between: [
          { field: 'asset', inverse: 'attachments', target: 'Asset' },
          { field: 'document', inverse: 'documents', target: 'Document' },
        ],
        constraints: [{
          description: 'The asset and document must share an owner.',
          name: 'sameOwnerEdge',
          type: Constraint.Validation,
          where: 'asset.owner = document.owner',
        }],
        fields: [{ field: 'note', nullable: true, type: 'String' }],
        name: 'Attachment',
        security: publicActions,
      }],
    })
    const install = tempDirectory('basis-mutation-edge-validation-')
    const server = await start(install, edgeGraph)
    try {
      const owner = await server.db.create('User', { name: 'Owner' })
      const other = await server.db.create('User', { name: 'Other' })
      const asset = await server.db.create('Asset', { name: 'Asset', owner: owner.record?.id })
      const otherAsset = await server.db.create('Asset', {
        name: 'Other asset',
        owner: other.record?.id,
      })
      const repairAsset = await server.db.create('Asset', {
        name: 'Repair asset',
        owner: owner.record?.id,
      })
      const document = await server.db.create('Document', {
        name: 'Document',
        owner: owner.record?.id,
      })
      const section = await server.db.create('Section', {
        document: document.record?.id,
        name: 'Section',
      })

      expect(await server.db.tx(async sql => sql.create('Attachment', {
        asset: asset.record?.id,
        document: document.record?.id,
        note: 'matching',
      }))).toEqual({ created: 1 })
      expect(await server.db.tx(async sql => sql.edit(
        'Attachment',
        { field: 'asset', operator: Operator.Comparison.Equal, value: asset.record?.id },
        { note: 'edited' },
      ))).toEqual({ edited: 1 })

      const failure = await server.db.tx(async sql => {
        await sql.create('User', { name: 'Rollback owner' })
        return sql.create('Attachment', {
          asset: otherAsset.record?.id,
          document: document.record?.id,
        })
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(MutationError)
      expect(failure).toMatchObject({ code: 'constraint' })
      expect((failure as MutationError).message).toContain('sameOwnerEdge')
      expect((failure as MutationError).message).toContain('Attachment')
      expect(await server.db.query('User', {
        fields: ['id'],
        where: { field: 'name', operator: Operator.Comparison.Equal, value: 'Rollback owner' },
      })).toEqual([])

      await server.db.tx(async sql => {
        await sql.create('Attachment', {
          asset: otherAsset.record?.id,
          document: document.record?.id,
        })
        await sql.delete('Attachment', {
          field: 'asset',
          operator: Operator.Comparison.Equal,
          value: otherAsset.record?.id,
        })
        await sql.create('Attachment', {
          asset: repairAsset.record?.id,
          document: document.record?.id,
        })
      })

      expect(await server.db.tx(async sql => sql.create('Anchor', {
        asset: asset.record?.id,
        name: 'Matching anchor',
        section: section.record?.id,
      }))).toMatchObject({ created: 1 })

      const anchorFailure = await server.db.tx(async sql => {
        await sql.create('User', { name: 'Anchor rollback' })
        return sql.create('Anchor', {
          asset: otherAsset.record?.id,
          name: 'Mismatched anchor',
          section: section.record?.id,
        })
      }).catch((error: unknown) => error)
      expect(anchorFailure).toBeInstanceOf(MutationError)
      expect(anchorFailure).toMatchObject({ code: 'constraint' })
      expect((anchorFailure as MutationError).message).toContain('sameOwnerPath')
      expect(await server.db.query('User', {
        fields: ['id'],
        where: { field: 'name', operator: Operator.Comparison.Equal, value: 'Anchor rollback' },
      })).toEqual([])

      expect(await server.db.delete('Attachment', {
        field: 'document',
        operator: Operator.Comparison.Equal,
        value: document.record?.id,
      })).toEqual({ deleted: 2 })
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)

  test('checks proposed reference paths for update policies and reacts to membership changes', async () => {
    const membershipGraph = new Graph({
      entities: [
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Organization',
          security: {
            [Action.Create]: Security.Public,
            [Action.Read]: Security.Public,
          },
        },
        {
          fields: [{ field: 'email', type: 'String' }],
          name: 'User',
          security: { [Action.Read]: Security.Public },
        },
        {
          fields: [
            { field: 'organization', target: 'Organization', type: 'Entity' },
            { field: 'title', type: 'String' },
          ],
          name: 'Document',
          security: {
            [Action.Create]: { where: 'organization.members $contains (id = $me)' },
            [Action.Read]: { where: 'organization.members $contains (id = $me)' },
            [Action.Update]: { where: 'organization.members $contains (id = $me)' },
          },
        },
        {
          fields: [{ field: 'document', target: 'Document', type: 'Entity' }],
          name: 'Section',
        },
        {
          fields: [
            { field: 'section', target: 'Section', type: 'Entity' },
            { field: 'title', type: 'String' },
          ],
          name: 'Page',
          security: {
            [Action.Read]: {
              where: 'section.document.organization.members $contains (id = $me)',
            },
            [Action.Update]: {
              where: 'section.document.organization.members $contains (id = $me)',
            },
          },
        },
      ],
      relationships: [{
        between: [
          { field: 'organization', inverse: 'members', target: 'Organization' },
          { field: 'user', inverse: 'users', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
        security: {
          [Action.Create]: Security.Public,
          [Action.Delete]: Security.Public,
          [Action.Read]: Security.Public,
          [Action.Update]: Security.Public,
        },
      }],
    })
    const install = tempDirectory('basis-mutation-proposed-paths-')
    const server = await start(install, membershipGraph)
    const admin = await openAdmin(server.db)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const worker = await authorization.enrollIdentity('test', 'proposed-worker', {
        email: 'worker@example.com',
      })
      if (!worker) throw new Error('worker was not enrolled')
      const organizationA = randomUUID()
      const organizationB = randomUUID()
      const documentA = randomUUID()
      const documentB = randomUUID()
      const sectionA = randomUUID()
      const sectionB = randomUUID()
      const page = randomUUID()
      await admin.sql.begin(async tx => {
        for (const [id, title, entity] of [
          [organizationA, 'Organization A', 'Organization'],
          [organizationB, 'Organization B', 'Organization'],
          [documentA, 'Document A', 'Document'],
          [documentB, 'Document B', 'Document'],
          [sectionA, 'Section A', 'Section'],
          [sectionB, 'Section B', 'Section'],
          [page, 'Page', 'Page'],
        ] as const) {
          await tx`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${id}, ${title}, ${entity})
          `
        }
        await tx`
          INSERT INTO "Organization" ("id", "title")
          VALUES (${organizationA}, 'Organization A'), (${organizationB}, 'Organization B')
        `
        await tx`
          INSERT INTO "Document" ("id", "title", "organization.id")
          VALUES (${documentA}, 'Document A', ${organizationA}),
            (${documentB}, 'Document B', ${organizationB})
        `
        await tx`
          INSERT INTO "Section" ("id", "document.id")
          VALUES (${sectionA}, ${documentA}), (${sectionB}, ${documentB})
        `
        await tx`
          INSERT INTO "Page" ("id", "title", "section.id")
          VALUES (${page}, 'Page', ${sectionA})
        `
        await tx`
          INSERT INTO "Membership" ("organization.id", "user.id", "role")
          VALUES (${organizationA}, ${worker}, 'Owner')
        `
      })
      const asActor = <T>(actor: string | null, work: () => T): T => runAsActor({ id: actor }, work)
      expect(await asActor(worker, () => server.db.edit(
        'Page',
        { field: 'title', operator: Operator.Comparison.Equal, value: 'Page' },
        { title: 'Page edited' },
      ))).toMatchObject({ edited: 1 })

      const blocked = await asActor(worker, () => server.db.edit(
        'Page',
        { field: 'title', operator: Operator.Comparison.Equal, value: 'Page edited' },
        { section: sectionB },
      )).catch((error: unknown) => error)
      expect(blocked).toBeInstanceOf(MutationError)
      expect(blocked).toMatchObject({ code: 'authorization' })

      expect(await asActor(worker, () => server.db.create('Document', {
        name: 'Created in A',
        organization: organizationA,
        title: 'Created in A',
      }))).toMatchObject({ created: 1 })
      const deniedCreate = await asActor(worker, () => server.db.create('Document', {
        name: 'Created in B',
        organization: organizationB,
        title: 'Created in B',
      })).catch((error: unknown) => error)
      expect(deniedCreate).toBeInstanceOf(MutationError)
      expect(deniedCreate).toMatchObject({ code: 'authorization' })
      expect(await asActor(worker, () => server.db.query('Document', {
        fields: ['id'],
        where: { field: 'title', operator: Operator.Comparison.Equal, value: 'Created in B' },
      }))).toEqual([])

      const proposedRow = {
        id: randomUUID(),
        name: 'Proposed',
        organization: organizationA,
        title: 'Proposed',
      }
      const proposedExpression = authorization.graph.createExpression('Document', proposedRow)
      if (!proposedExpression) throw new Error('createExpression did not compile')
      const evaluate = (expression: string) => asActor(worker, () => server.db.tx(async sql => {
        const rows = await sql.unsafe<{ allowed: boolean }[]>(`SELECT (${expression}) AS "allowed"`)
        return rows[0]?.allowed
      }))
      expect(await evaluate(proposedExpression)).toBe(true)
      const deniedExpression = authorization.graph.accessExpression(Action.Create, 'Document', {
        ...proposedRow,
        organization: organizationB,
      })
      if (!deniedExpression) throw new Error('accessExpression did not compile')
      expect(await evaluate(deniedExpression)).toBe(false)

      await admin.sql`
        INSERT INTO "Membership" ("organization.id", "user.id", "role")
        VALUES (${organizationB}, ${worker}, 'Viewer')
      `
      expect(await evaluate(deniedExpression)).toBe(true)
      expect(await asActor(worker, () => server.db.edit(
        'Page',
        { field: 'title', operator: Operator.Comparison.Equal, value: 'Page edited' },
        { section: sectionB },
      ))).toMatchObject({ edited: 1 })
    } finally {
      await admin.close()
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)

  test('rolls back final-state validation through the real db.tx boundary', async () => {
    const publicActions = {
      [Action.Create]: Security.Public,
      [Action.Delete]: Security.Public,
      [Action.Read]: Security.Public,
      [Action.Update]: Security.Public,
    }
    const stateGraph = new Graph({
      entities: [
        { fields: [], name: 'User', security: publicActions },
        {
          fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
          name: 'Revision',
          security: publicActions,
        },
        {
          constraints: [{
            description: 'The document and revision must share an owner.',
            name: 'consistentRevision',
            type: Constraint.Validation,
            where: 'revision = null OR owner = revision.owner',
          }],
          fields: [
            { field: 'owner', target: 'User', type: 'Entity' },
            { field: 'revision', nullable: true, target: 'Revision', type: 'Entity' },
            { field: 'title', type: 'String' },
          ],
          name: 'Document',
          security: publicActions,
        },
      ],
    })
    const install = tempDirectory('basis-mutation-tx-validation-')
    const server = await start(install, stateGraph)
    try {
      const owner = await server.db.create('User', { name: 'Owner' })
      const other = await server.db.create('User', { name: 'Other' })
      const revision = await server.db.create('Revision', {
        name: 'Revision',
        owner: owner.record?.id,
      })
      const filter = (title: string) => ({
        field: 'title',
        operator: Operator.Comparison.Equal,
        value: title,
      })

      expect(await server.db.create('Document', {
        name: 'Valid',
        owner: owner.record?.id,
        revision: revision.record?.id,
        title: 'Valid',
      })).toMatchObject({ created: 1 })

      const createFailure = await server.db.tx(async sql => {
        await sql.create('User', { name: 'Rollback' })
        await sql.create('Document', {
          name: 'Invalid',
          owner: other.record?.id,
          revision: revision.record?.id,
          title: 'Invalid',
        })
      }).catch((error: unknown) => error)
      expect(createFailure).toBeInstanceOf(MutationError)
      expect(createFailure).toMatchObject({ code: 'constraint' })
      expect((createFailure as MutationError).message).toContain('consistentRevision')
      expect((createFailure as MutationError).message).toContain('Document')
      expect(await server.db.query('User', {
        fields: ['id'],
        where: { field: 'name', operator: Operator.Comparison.Equal, value: 'Rollback' },
      })).toEqual([])

      const editFailure = await server.db.tx(async sql => sql.edit('Document', filter('Valid'), {
        owner: other.record?.id,
      })).catch((error: unknown) => error)
      expect(editFailure).toBeInstanceOf(MutationError)
      expect(editFailure).toMatchObject({ code: 'constraint' })
      expect(await server.db.query<{ owner: { entity: string, id: string, name: string } }>('Document', {
        fields: ['owner'],
        where: filter('Valid'),
      })).toEqual([{ owner: { entity: 'User', id: owner.record?.id, name: 'Owner' } }])

      const upsertFailure = await server.db.tx(async sql => sql.upsert('Document', filter('Upserted'), {
        name: 'Upserted',
        owner: other.record?.id,
        revision: revision.record?.id,
        title: 'Upserted',
      })).catch((error: unknown) => error)
      expect(upsertFailure).toBeInstanceOf(MutationError)
      expect(upsertFailure).toMatchObject({ code: 'constraint' })
      expect(await server.db.query('Document', { fields: ['id'], where: filter('Upserted') }))
        .toEqual([])

      await server.db.tx(async sql => {
        await sql.create('Document', {
          name: 'Repair',
          owner: other.record?.id,
          revision: revision.record?.id,
          title: 'Repair',
        })
        await sql.edit('Document', filter('Repair'), { owner: owner.record?.id })
      })
      expect(await server.db.query<{ owner: { entity: string, id: string, name: string } }>('Document', {
        fields: ['owner'],
        where: filter('Repair'),
      })).toEqual([{ owner: { entity: 'User', id: owner.record?.id, name: 'Owner' } }])
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 180_000)
})
