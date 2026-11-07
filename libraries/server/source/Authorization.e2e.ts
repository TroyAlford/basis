import { Logger } from 'basis/logger'
import type { Identity } from 'basis/oauth'
import { HttpVerb } from 'basis/server'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { runAsActor } from './ActorContext'
import { ADMIN_ROLE_ID } from './Graph'
import { Graph } from './Graph'
import { Server } from './Server'

const silent = new Logger({ silent: true })

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: 'String' }], name: 'User' },
    { extends: 'User', fields: [], name: 'ApplicationUser' },
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Article',
    },
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Post',
    },
    { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
    { extends: 'Profile', fields: [], name: 'Employee' },
  ],
  grants: [
    { action: 'manage', role: 'admin', target: '*' },
    { action: 'create', role: 'admin', target: 'Article' },
    { action: 'create', role: 'admin', target: 'Post' },
    { action: 'create', role: 'admin', target: 'Profile' },
    { action: 'create', role: 'admin', target: 'Employee' },
    { action: 'create', role: 'admin', target: 'User' },
    { action: 'create', role: 'admin', target: 'ApplicationUser' },
    { action: 'read', role: 'admin', target: 'Article' },
    { action: 'read', predicate: 'owner = $me', role: 'public', target: 'Article' },
    { action: 'read', role: 'public', target: 'Post' },
    { action: 'create', predicate: "title = 'Allowed'", role: 'public', target: 'Article' },
    { action: 'read', role: 'editor', target: 'Article' },
    { action: 'update', role: 'editor', target: 'Article' },
    { action: 'read', role: 'limited', target: 'Article' },
    { action: 'update', predicate: "title = 'Updated'", role: 'limited', target: 'Article' },
    { action: 'read', predicate: "email = 'employee@example.com'", role: 'public', target: 'Employee' },
    {
      action: 'read',
      predicate: "email = 'application@example.com'",
      role: 'public',
      target: 'ApplicationUser',
    },
  ],
  roles: {
    editor: { name: 'Editor' },
    limited: { name: 'Limited' },
  },
})

/**
 * Start one isolated authorization server.
 * @param install - Temporary installation root.
 * @returns The started server.
 */
async function start(install: string): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(graph)
    .database({ entities: graph.definitions })
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  process.chdir(previous)
  await server.ready()
  return server
}

describe('Authorization RLS', () => {
  test('compiles graph permissions into PostgreSQL policies', async () => {
    const install = tempDirectory('basis-authorization-')
    const server = await start(install)
    try {
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
      const [role] = await server.db.sql<{
        bypass: boolean,
        current: string,
        superuser: boolean,
      }[]>`
        SELECT current_user AS current, r.rolsuper AS superuser, r.rolbypassrls AS bypass
        FROM pg_roles r
        WHERE r.rolname = current_user
      `
      expect(role?.current).toBe('basis_app')
      expect(role?.superuser).toBe(false)
      expect(role?.bypass).toBe(false)

      const user = await authorization.enrollIdentity('test', 'user', { email: 'user@example.com' })
      const other = await authorization.enrollIdentity('test', 'other', { email: 'other@example.com' })
      const same = await authorization.enrollIdentity('test', 'user', { email: 'user@example.com' })
      const collision = await authorization.enrollIdentity('other', 'user', { email: 'collision@example.com' })
      if (!user || !other || !same || !collision) throw new Error('identity mapping failed')
      expect(same).toBe(user)
      expect(collision).not.toBe(user)

      expect(await asActor(admin.userId, () => authorization.can('manage', 'UserRole'))).toBe(true)
      expect(await asActor(user, () => authorization.can('manage', 'UserRole'))).toBe(false)

      const article = randomUUID()
      const otherArticle = randomUUID()
      const ownPost = randomUUID()
      const otherPost = randomUUID()
      await asActor(admin.userId, () => server.db.tx(async sql => {
        for (const [id, title, owner] of [
          [article, 'Private', user],
          [otherArticle, 'Other', other],
        ] as const) {
          await sql`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${id}, ${title}, 'Article')
          `
          await sql`
            INSERT INTO "Article" ("id", "title", "owner.id")
            VALUES (${id}, ${title}, ${owner})
          `
        }
        for (const [id, title, owner] of [
          [ownPost, 'Own post', user],
          [otherPost, 'Other post', other],
        ] as const) {
          await sql`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${id}, ${title}, 'Post')
          `
          await sql`
            INSERT INTO "Post" ("id", "title", "owner.id")
            VALUES (${id}, ${title}, ${owner})
          `
        }
      }))

      const own = await asActor(user, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(own).toEqual([{ id: article, title: 'Private' }])
      const stranger = await asActor(other, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(stranger).toEqual([{ id: otherArticle, title: 'Other' }])
      const anonymous = await asActor(null, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(anonymous).toEqual([])

      const direct = await asActor(user, () => server.db.tx(async sql => (
        sql<{ id: string }[]>`
          SELECT "id"
          FROM "Article"
          ORDER BY "id"
        `
      )))
      expect(direct).toEqual([{ id: article }])

      const allPosts = await asActor(user, () => server.db.query('Post', {
        fields: ['id', 'title'],
        orderBy: 'title',
      }))
      expect(allPosts).toEqual([
        { id: otherPost, title: 'Other post' },
        { id: ownPost, title: 'Own post' },
      ])
      const searched = await asActor(user, () => server.db.query('Post', {
        fields: ['id', 'title'],
        where: 'owner = $me',
      }))
      expect(searched).toEqual([{ id: ownPost, title: 'Own post' }])
      const structured = await asActor(user, () => server.db.query('Post', {
        fields: ['id', 'title'],
        where: { field: 'owner', operator: '$eq', value: '$me' },
      }))
      expect(structured).toEqual([{ id: ownPost, title: 'Own post' }])
      const literal = await asActor(other, () => server.db.query('Post', {
        fields: ['id', 'title'],
        where: { field: 'owner', operator: '$eq', value: user },
      }))
      expect(literal).toEqual([{ id: ownPost, title: 'Own post' }])

      const actorSetting = await asActor(user, () => server.db.tx(async sql => (
        sql<{ actor: string | null }[]>`
          SELECT current_setting('actor.id', TRUE) AS actor
        `
      )))
      expect(actorSetting[0]?.actor).toBe(user)
      const anonymousSetting = await asActor(null, () => server.db.tx(async sql => (
        sql<{ actor: string | null }[]>`
          SELECT current_setting('actor.id', TRUE) AS actor
        `
      )))
      expect(anonymousSetting[0]?.actor ?? '').toBe('')

      const changed = await asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Leaked'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(changed).toHaveLength(0)

      await expect(asActor(other, () => server.db.tx(async sql => sql`
        ALTER TABLE "Article" DISABLE ROW LEVEL SECURITY
      `))).rejects.toThrow()
      await expect(asActor(other, () => server.db.tx(async sql => sql`
        INSERT INTO "UserRole" ("user.id", "role.id")
        VALUES (${other}, ${ADMIN_ROLE_ID})
      `))).rejects.toThrow()

      expect(await asActor(user, () => authorization.can('create', 'Article', {
        title: 'Allowed',
      }))).toBe(true)
      expect(await asActor(user, () => authorization.can('create', 'Article', {
        title: 'Denied',
      }))).toBe(false)
      expect(await asActor(admin.userId, () => authorization.can('create', 'Article', {
        title: 'Denied',
      }))).toBe(true)

      const allowed = randomUUID()
      await asActor(user, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${allowed}, 'Allowed', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${allowed}, 'Allowed', ${user})
        `
      }))
      await expect(asActor(user, () => server.db.tx(async sql => {
        const denied = randomUUID()
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${denied}, 'Denied', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${denied}, 'Denied', ${user})
        `
      }))).rejects.toThrow()

      const editor = graph.role('editor')
      const limited = graph.role('limited')
      if (!editor || !limited) throw new Error('graph roles were not loaded')
      await asActor(admin.userId, () => authorization.assignRole(other, editor.id))
      expect(await asActor(other, () => authorization.can('update', 'Article', { id: otherArticle }))).toBe(true)
      const updated = await asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Updated'
        WHERE "id" = ${otherArticle}
        RETURNING "id"
      `))
      expect(updated).toHaveLength(1)
      await asActor(admin.userId, () => authorization.removeRole(other, editor.id))
      await asActor(admin.userId, () => authorization.assignRole(other, limited.id))
      await expect(asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Changed'
        WHERE "id" = ${otherArticle}
        RETURNING "id"
      `))).rejects.toThrow()
      const sameTitle = await asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Updated'
        WHERE "id" = ${otherArticle}
        RETURNING "id"
      `))
      expect(sameTitle).toHaveLength(1)

      const employeeId = randomUUID()
      const applicationUserId = randomUUID()
      await asActor(admin.userId, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${employeeId}, 'employee@example.com', 'Employee')
        `
        await sql`
          INSERT INTO "Profile" ("id", "email")
          VALUES (${employeeId}, 'employee@example.com')
        `
        await sql`
          INSERT INTO "Employee" ("id")
          VALUES (${employeeId})
        `
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${applicationUserId}, 'application@example.com', 'ApplicationUser')
        `
        await sql`
          INSERT INTO "User" ("id", "email")
          VALUES (${applicationUserId}, 'application@example.com')
        `
        await sql`
          INSERT INTO "ApplicationUser" ("id")
          VALUES (${applicationUserId})
        `
      }))
      expect(await asActor(other, () => server.db.query('Employee', { fields: ['id', 'email'] })))
        .toEqual([{ email: 'employee@example.com', id: employeeId }])
      expect(await asActor(other, () => server.db.query('ApplicationUser', { fields: ['id', 'email'] })))
        .toEqual([{ email: 'application@example.com', id: applicationUserId }])

      const grants = await asActor(admin.userId, () => authorization.effective(null))
      expect(grants.some(grant => grant.target === 'Article' && grant.action === 'read')).toBe(true)

      server.identity({ get: () => user } as unknown as Identity)
      server.api([HttpVerb.Get], 'secure-articles', async (_params, context) => {
        if (!context.db) throw new Error('request database is missing')
        return Response.json(await context.db.query('Article', { fields: ['id', 'title'] }))
      })
      const response = await server.handle(new Request('http://localhost/api/secure-articles'))
      const requested = await response?.json() as { id: string, title: string }[]
      expect(requested).toHaveLength(2)
      expect(requested).toEqual(expect.arrayContaining([
        { id: article, title: 'Private' },
        { id: allowed, title: 'Allowed' },
      ]))

      server.api([HttpVerb.Get], 'bootstrap-attempt', async () => {
        try {
          await authorization.bootstrap({ provider: 'evil', subject: 'evil' })
          return new Response('ok')
        } catch {
          return new Response('blocked', { status: 403 })
        }
      })
      const bootstrapAttempt = await server.handle(new Request('http://localhost/api/bootstrap-attempt'))
      expect(bootstrapAttempt?.status).toBe(403)

      await asActor(admin.userId, () => authorization.revokeIdentity('test', 'other'))
      expect(await authorization.resolve(other)).toBeNull()
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)
})
