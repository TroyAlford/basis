import { Logger } from 'basis/logger'
import type { Identity } from 'basis/oauth'
import { HttpVerb } from 'basis/server'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { Authorization } from './Authorization'
import { Server } from './Server'

const silent = new Logger({ silent: true })

const application = Authorization.load(JSON.stringify({
  entities: [{
    fields: [
      { field: 'title', type: 'String' },
      { field: 'owner', target: 'User', type: 'Entity' },
    ],
    name: 'Article',
  }],
}))

/**
 * Start one isolated authorization server.
 * @param install - Temporary installation root.
 * @returns The started server.
 */
async function start(install: string): Promise<Server> {
  const previous = process.cwd()
  process.chdir(install)
  const server = new Server()
    .authorization({ definitions: application })
    .database({ entities: application })
    .root(install)
  server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  process.chdir(previous)
  await server.ready()
  return server
}

describe('Authorization RLS', () => {
  test('maps identities, enforces conditional grants, and rejects forged actors', async () => {
    const install = tempDirectory('basis-authorization-')
    const server = await start(install)
    try {
      const authorization = server.auth
      if (!authorization) throw new Error('authorization did not initialize')
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
      const user = await authorization.login('test', 'user', { email: 'user@example.com' })
      const other = await authorization.login('test', 'other', { email: 'other@example.com' })
      const sameUser = await authorization.login('test', 'user', { email: 'user@example.com' })
      const collision = await authorization.login('other', 'user', { email: 'collision@example.com' })
      if (!user || !other || !sameUser || !collision) throw new Error('identity mapping failed')
      expect(sameUser).toBe(user)
      expect(collision).not.toBe(user)
      expect(await authorization.can(user, 'manage', 'Grant')).toBe(false)
      expect(await authorization.can(admin.userId, 'read', 'Article')).toBe(false)

      await authorization.grant(admin.userId, { action: 'create', role: 'admin', target: 'Article' })
      const article = randomUUID()
      await authorization.run(admin.userId, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${article}, 'Article', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${article}, 'Private', ${user})
        `
      }))

      await authorization.grant(admin.userId, {
        action: 'read',
        predicate: { field: 'owner.id', operator: '$eq', value: { $actor: true } },
        role: 'public',
        target: 'Article',
      })

      const own = await authorization.run(user, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(own).toEqual([{ id: article, title: 'Private' }])
      const stranger = await authorization.run(other, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(stranger).toEqual([])
      const anonymous = await authorization.run(null, () => server.db.query('Article', {
        fields: ['id', 'title'],
      }))
      expect(anonymous).toEqual([])

      const direct = await authorization.run(user, () => server.db.tx(async sql => {
        const rows = await sql<{ id: string }[]>`
          SELECT "id"
          FROM "Article"
        `
        return rows
      }))
      expect(direct).toEqual([{ id: article }])

      const forged = await authorization.run(user, () => server.db.tx(async sql => {
        await sql`
          SELECT set_config('basis.actor', 'deadbeef:9999999999:forged', TRUE)
        `
        return sql<{ id: string }[]>`
          SELECT "id"
          FROM "Article"
        `
      }))
      expect(forged).toEqual([])

      const changed = await authorization.run(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Leaked'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(changed).toHaveLength(0)

      await expect(authorization.run(other, () => server.db.tx(async sql => sql`
        ALTER TABLE "Article" DISABLE ROW LEVEL SECURITY
      `))).rejects.toThrow()
      await expect(authorization.assignRole(admin.userId, admin.userId, 'admin')).rejects.toThrow()

      const editor = 'editor'
      await authorization.createRole(admin.userId, editor, 'Editor')
      await authorization.assignRole(admin.userId, other, editor)
      await authorization.grant(admin.userId, {
        action: 'read',
        role: editor,
        target: 'Article',
      })
      await authorization.grant(admin.userId, {
        action: 'update',
        role: editor,
        target: 'Article',
      })
      expect(await authorization.can(other, 'update', 'Article', { id: article })).toBe(true)
      const updated = await authorization.run(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Updated'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(updated).toHaveLength(1)
      await authorization.removeRole(admin.userId, other, editor)
      const deniedAgain = await authorization.run(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Leaked'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(deniedAgain).toHaveLength(0)

      const limited = 'limited'
      await authorization.createRole(admin.userId, limited, 'Limited')
      await authorization.assignRole(admin.userId, other, limited)
      await authorization.grant(admin.userId, { action: 'read', role: limited, target: 'Article' })
      await authorization.grant(admin.userId, {
        action: 'update',
        predicate: { field: 'title', operator: '$eq', value: 'Updated' },
        role: limited,
        target: 'Article',
      })
      await expect(authorization.run(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Changed'
        WHERE "id" = ${article}
        RETURNING "id"
      `))).rejects.toThrow()

      server.identity({ get: () => user } as unknown as Identity)
      server.api([HttpVerb.Get], 'secure-articles', async (_params, context) => {
        if (!context.db) throw new Error('request database is missing')
        const rows = await context.db.query('Article', { fields: ['id', 'title'] })
        return Response.json(rows)
      })
      const response = await server.handle(new Request('http://localhost/api/secure-articles'))
      expect(await response?.json()).toEqual([{ id: article, title: 'Updated' }])

      const allowedId = randomUUID()
      await authorization.grant(admin.userId, {
        action: 'create',
        predicate: { field: 'id', operator: '$eq', value: allowedId },
        role: 'public',
        target: 'Article',
      })
      await authorization.run(user, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${allowedId}, 'Allowed', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${allowedId}, 'Allowed', ${user})
        `
      }))
      await expect(authorization.run(other, () => server.db.tx(async sql => {
        const deniedId = randomUUID()
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${deniedId}, 'Denied', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${deniedId}, 'Denied', ${other})
        `
      }))).rejects.toThrow()

      const publicGrant = (await authorization.effective(admin.userId, null))
        .find(grant => grant.role === 'public' && grant.action === 'read' && grant.target === 'Article')
      if (!publicGrant) throw new Error('public grant was not created')
      await authorization.revoke(admin.userId, publicGrant.id)
      expect(await authorization.run(user, () => server.db.query('Article', {
        fields: ['id', 'title'],
      }))).toEqual([])

      await authorization.revokeIdentity(admin.userId, 'test', 'other')
      expect(await authorization.resolve(other)).toBeNull()

    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)
})
