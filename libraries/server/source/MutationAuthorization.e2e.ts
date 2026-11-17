import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, ADMIN_ROLE_ID, Graph, Security } from './Graph'
import { MutationError } from './Mutation'
import { Operator } from './Operator'

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

type DatabaseSql = DatabaseContext['sql']

/**
 * Resolve authored role names to stable ids.
 * @param names - Role names.
 * @returns Their canonical ids.
 */
function roleIds(names: readonly string[]): string[] {
  return names.map(name => {
    const details = graph.role(name)
    if (!details) throw new Error(`role "${name}" was not loaded`)
    return details.id
  })
}

/**
 * Enroll one canonical identity through the fixture owner transaction.
 * @param sql - Owner database transaction.
 * @param user - Canonical User id.
 * @param provider - Provider slug.
 * @param subject - Stable provider subject.
 * @param email - Verified email address.
 * @param roles - Role ids to assign.
 * @returns The canonical User id.
 */
async function enroll(
  sql: DatabaseSql,
  user: string,
  provider: string,
  subject: string,
  email: string,
  roles: readonly string[],
): Promise<string> {
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${user}, ${subject}, 'User')
  `
  await sql`
    INSERT INTO "User" ("id", "email")
    VALUES
      (${user}, ${email})
  `
  const identity = randomUUID()
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${identity}, ${`${provider}:${subject}`}, 'ExternalIdentity')
  `
  await sql`
    INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
    VALUES
      (${identity}, ${provider}, ${subject}, FALSE, ${user})
  `
  for (const role of roles) {
    await sql`
      INSERT INTO "UserRole" ("user.id", "role.id")
      VALUES
        (${user}, ${role})
    `
  }
  return user
}

/**
 * App-role server view over one fixture transaction.
 * @param database - The active fixture context.
 * @returns The database and the role-assignment capability used by the proof.
 */
function fixtureServer(database: DatabaseContext) {
  return {
    auth: {
      assignRole: async (user: string, role: string): Promise<void> => {
        await database.sql`
          INSERT INTO "UserRole" ("user.id", "role.id")
          VALUES
            (${user}, ${role})
        `
      },
      graph,
    },
    db: database,
  }
}

describe('Graph mutation authorization', () => {
  test('selects READ-visible candidates and counts only writes passing READ plus the specific action', async () => {
    const administrator = randomUUID()
    const worker = randomUUID()
    await withDatabase('mutation-authorization-selection', administrator, async database => {
      const server = fixtureServer(database)
      const asActor = async <T>(actor: string | null, work: () => T | Promise<T>): Promise<T> => {
        await database.sql`
          SELECT set_config('actor.id', ${actor ?? ''}, TRUE)
        `
        return await work()
      }
      const updater = graph.role('updater')
      const deleter = graph.role('deleter')
      const creator = graph.role('creator')
      if (!updater || !deleter || !creator) throw new Error('roles were not loaded')

      expect(await asActor(administrator, () => server.db.create('Article', Array.from(
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

      await asActor(administrator, () => server.auth.assignRole(worker, creator.id))
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
    }, {
      graph,
      setup: async owner => {
        await enroll(
          owner.sql,
          administrator,
          'test',
          'admin',
          'admin@example.com',
          [ADMIN_ROLE_ID],
        )
        await enroll(
          owner.sql,
          worker,
          'test',
          'selection-worker',
          'selection-worker@example.com',
          roleIds(['updater', 'deleter']),
        )
      },
    })
  })

  test('requires READ before writes, checks new rows, and honors inherited membership security', async () => {
    const administrator = randomUUID()
    const worker = randomUUID()
    await withDatabase('mutation-authorization-read-gate', administrator, async database => {
      const server = fixtureServer(database)
      const asActor = async <T>(actor: string | null, work: () => T | Promise<T>): Promise<T> => {
        await database.sql`
          SELECT set_config('actor.id', ${actor ?? ''}, TRUE)
        `
        return await work()
      }
      await asActor(administrator, () => server.db.create('Draft', [
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
      const stillPresent = await asActor(administrator, () => server.db.query<{ rank: number }>('Draft', {
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
      expect(await asActor(administrator, () => server.db.query('Draft', { fields: ['id'], limit: null })))
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

      const readable = await asActor(administrator, () => server.db.query<{ id: string }>('Draft', {
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
      expect(await asActor(administrator, () => server.db.query('Draft', {
        fields: ['rank'],
        limit: null,
        where: compare('id', Operator.Comparison.Equal, first.id),
      }))).toEqual([{ rank: 10 }])

      await asActor(administrator, () => server.db.create('Project', [
        { code: 'A', name: 'Member project', title: 'Member project' },
        { code: 'B', name: 'Other project', title: 'Other project' },
      ]))
      const projects = await asActor(administrator, () => server.db.query<{ code: string, id: string }>('Project', {
        fields: ['id', 'code'],
        limit: null,
        orderBy: 'code',
      }))
      expect(projects).toHaveLength(2)
      const [memberProject, otherProject] = projects
      if (!memberProject || !otherProject) throw new Error('Projects were not created')
      await asActor(administrator, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
          VALUES
            (${memberProject.id}, ${worker}, ${MembershipRole.Owner})
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
      expect(await asActor(administrator, () => server.db.query<{ id: string, title: string }>('Project', {
        fields: ['id', 'title'],
        limit: null,
        orderBy: 'code',
      }))).toEqual([
        { id: memberProject.id, title: 'Member updated' },
        { id: otherProject.id, title: 'Other project' },
      ])
    }, {
      graph,
      setup: async owner => {
        await enroll(
          owner.sql,
          administrator,
          'test',
          'admin',
          'admin@example.com',
          [ADMIN_ROLE_ID],
        )
        await enroll(
          owner.sql,
          worker,
          'test',
          'read-gate-worker',
          'read-gate-worker@example.com',
          roleIds(['creator', 'deleter', 'reader', 'updater']),
        )
      },
    })
  })
})
