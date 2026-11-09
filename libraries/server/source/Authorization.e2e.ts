import { Logger } from 'basis/logger'
import { Identity } from 'basis/oauth'
import { HttpVerb } from 'basis/server'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { runAsActor } from './ActorContext'
import { openAdmin } from './Database'
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
 * Capture response cookies while a server response is built.
 * @returns The captured cookies and a restore function.
 */
function captureSetCookie(): { readonly cookies: string[], restore: () => void } {
  const cookies: string[] = []
  const append = Headers.prototype.append
  Headers.prototype.append = function (this: Headers, name: string, value: string): void {
    if (name.toLowerCase() === 'set-cookie') cookies.push(value)
    append.call(this, name, value)
  }
  return { cookies, restore: (): void => { Headers.prototype.append = append } }
}

/**
 * Start one isolated authorization server.
 * @param install - Temporary installation root.
 * @param applicationGraph - Graph to install for the server.
 * @returns The started server.
 */
async function start(install: string, applicationGraph: Graph = graph): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .graph(applicationGraph)
    .database()
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  process.chdir(previous)
  await server.ready()
  const admin = await openAdmin(server.db)
  try {
    await installSchema(admin.sql, applicationGraph, {
      appRole: 'basis_app',
      schema: 'public',
      superuser: true,
      version: `authorization-${randomUUID()}`,
    })
  } finally {
    await admin.close()
  }
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
      expect(await authorization.enrollIdentity('test', 'admin', { email: 'admin@example.com' }))
        .toBe(admin.userId)
      const concurrent = await Promise.all(Array.from({ length: 8 }, () => (
        authorization.enrollIdentity('test', 'concurrent', { email: 'concurrent@example.com' })
      )))
      expect(new Set(concurrent).size).toBe(1)
      expect(concurrent[0]).not.toBeNull()

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
      expect(await authorization.enrollIdentity('test', 'other', { email: 'other@example.com' }))
        .toBeNull()
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)

  test('declines ambiguous targets and missing required User fields', async () => {
    const ambiguousInstall = tempDirectory('basis-authorization-ambiguous-')
    const ambiguousGraph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        { extends: 'User', fields: [], name: 'CustomerUser' },
      ],
    })
    const ambiguousServer = await start(ambiguousInstall, ambiguousGraph)
    try {
      const authorization = ambiguousServer.auth
      if (!authorization) throw new Error('authorization did not initialize')
      await authorization.bootstrap()
      const existingUserId = randomUUID()
      const admin = await openAdmin(ambiguousServer.db)
      try {
        await admin.sql.begin(async tx => {
          await tx`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${existingUserId}, 'existing@example.com', 'AdminUser')
          `
          await tx`
            INSERT INTO "User" ("id", "email")
            VALUES (${existingUserId}, 'existing@example.com')
          `
          await tx`
            INSERT INTO "AdminUser" ("id") VALUES (${existingUserId})
          `
          const identityId = randomUUID()
          await tx`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${identityId}, 'test:existing', 'ExternalIdentity')
          `
          await tx`
            INSERT INTO "ExternalIdentity" ("id", "provider", "subject", "revoked", "user.id")
            VALUES (${identityId}, 'test', 'existing', false, ${existingUserId})
          `
        })
        expect(await authorization.enrollIdentity('test', 'existing', { email: 'existing@example.com' }))
          .toBe(existingUserId)
        await admin.sql`
          UPDATE "ExternalIdentity"
          SET "revoked" = true
          WHERE "provider" = 'test' AND "subject" = 'existing'
        `
        expect(await authorization.enrollIdentity('test', 'existing', { email: 'existing@example.com' }))
          .toBeNull()
      } finally {
        await admin.close()
      }
      await expect(authorization.enrollIdentity('test', 'ambiguous', { email: 'ambiguous@example.com' }))
        .rejects.toThrow('multiple concrete User descendants: AdminUser, CustomerUser')
    } finally {
      await ambiguousServer.shutdown()
      removeService(ambiguousInstall)
    }

    const requiredInstall = tempDirectory('basis-authorization-required-')
    const requiredGraph = new Graph({
      entities: [{
        fields: [
          { field: 'email', type: 'String' },
          { field: 'department', type: 'String' },
        ],
        name: 'User',
      }],
    })
    const requiredServer = await start(requiredInstall, requiredGraph)
    try {
      const authorization = requiredServer.auth
      if (!authorization) throw new Error('authorization did not initialize')
      await authorization.bootstrap()
      await expect(authorization.enrollIdentity('test', 'missing-department', {
        email: 'missing@example.com',
      })).rejects.toThrow('department')
    } finally {
      await requiredServer.shutdown()
      removeService(requiredInstall)
    }
  }, 120_000)

  test('enrolls a complete MTI chain and rolls back incomplete creation', async () => {
    const tieredInstall = tempDirectory('basis-authorization-tiered-')
    const tieredGraph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [], name: 'Member' },
        { extends: 'Member', fields: [], name: 'PremiumMember' },
      ],
    })
    const tieredServer = await start(tieredInstall, tieredGraph)
    try {
      const authorization = tieredServer.auth
      if (!authorization) throw new Error('authorization did not initialize')
      const adminResult = await authorization.bootstrap({
        email: 'tiered@example.com',
        provider: 'test',
        subject: 'tiered',
      })
      if (!adminResult.userId) throw new Error('tiered bootstrap did not create a user')
      const admin = await openAdmin(tieredServer.db)
      try {
        const rows = await admin.sql<{ email: string, id: string }[]>`
          SELECT p."id", u."email"
          FROM "PremiumMember" p
          JOIN "Member" m ON m."id" = p."id"
          JOIN "User" u ON u."id" = m."id"
        `
        expect(rows).toEqual([{ email: 'tiered@example.com', id: adminResult.userId }])
      } finally {
        await admin.close()
      }
    } finally {
      await tieredServer.shutdown()
      removeService(tieredInstall)
    }

    const requiredChainInstall = tempDirectory('basis-authorization-required-chain-')
    const requiredChainGraph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [{ field: 'department', type: 'String' }], name: 'Member' },
        { extends: 'Member', fields: [], name: 'PremiumMember' },
      ],
    })
    const requiredChainServer = await start(requiredChainInstall, requiredChainGraph)
    try {
      const authorization = requiredChainServer.auth
      if (!authorization) throw new Error('authorization did not initialize')
      await authorization.bootstrap()
      await expect(authorization.enrollIdentity('test', 'incomplete', {
        email: 'incomplete@example.com',
      })).rejects.toThrow('department')
      const admin = await openAdmin(requiredChainServer.db)
      try {
        const [users] = await admin.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM "User"`
        const [members] = await admin.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM "Member"`
        const [premium] = await admin.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM "PremiumMember"`
        const [identities] = await admin.sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM "ExternalIdentity" WHERE "subject" = 'incomplete'
        `
        expect(users?.count).toBe(0)
        expect(members?.count).toBe(0)
        expect(premium?.count).toBe(0)
        expect(identities?.count).toBe(0)
      } finally {
        await admin.close()
      }
    } finally {
      await requiredChainServer.shutdown()
      removeService(requiredChainInstall)
    }
  }, 120_000)

  test('passes the verified OAuth profile through the Server owner', async () => {
    const install = tempDirectory('basis-authorization-oauth-profile-')
    const oauthGraph = new Graph({
      entities: [{ fields: [{ field: 'email', type: 'String' }], name: 'User' }],
    })
    const server = await start(install, oauthGraph)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
      await authorization.bootstrap()
      const session = new Identity({ provider: 'test', public: 'client-id', secret: 'client-secret' })
      server.oauth({
        authorize: state => `/api/oauth/callback?state=${state}`,
        exchange: async () => 'access-token',
        identity: async () => ({
          displayName: 'OAuth User',
          email: 'oauth@example.com',
          subject: 'oauth-subject',
        }),
        session,
      })

      const capture = captureSetCookie()
      let stateCookie = ''
      try {
        const login = await server.handle(new Request('http://localhost/api/oauth/login'))
        expect(login?.status).toBe(302)
        stateCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''
      } finally {
        capture.restore()
      }
      const state = stateCookie.split(';')[0]?.split('=')[1] ?? ''
      const callbackRequest = new Request(
        `http://localhost/api/oauth/callback?code=code&state=${state}`,
      )
      callbackRequest.headers.set('cookie', stateCookie.split(';')[0] ?? '')
      const callback = await server.handle(callbackRequest)
      expect(callback?.status).toBe(302)
      expect(await authorization.enrollIdentity('test', 'oauth-subject', { email: 'oauth@example.com' }))
        .not.toBeNull()
    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)
})
