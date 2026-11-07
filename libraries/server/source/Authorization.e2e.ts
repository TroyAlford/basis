import { Logger } from 'basis/logger'
import type { Identity } from 'basis/oauth'
import { HttpVerb } from 'basis/server'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { removeService } from '../testing/DatabaseFixture'
import { Authorization, AUTHORIZATION_RUN } from './Authorization'
import { Server } from './Server'

const silent = new Logger({ silent: true })

const application = Authorization.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Article',
    },
    { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
    { extends: 'Profile', fields: [], name: 'Employee' },
    { extends: 'User', fields: [], name: 'ApplicationUser' },
  ],
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
      const asActor = <T>(actor: string | null, work: () => T): T => authorization[AUTHORIZATION_RUN](actor, work)
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
      const other = await authorization.login('test', 'other', { email: 'other-employee@example.com' })
      const sameUser = await authorization.login('test', 'user', { email: 'user@example.com' })
      const collision = await authorization.login('other', 'user', { email: 'collision@example.com' })
      if (!user || !other || !sameUser || !collision) throw new Error('identity mapping failed')
      expect(sameUser).toBe(user)
      expect(collision).not.toBe(user)
      expect(await asActor(user, () => authorization.can('manage', 'Grant'))).toBe(false)
      expect(await asActor(admin.userId, () => authorization.can('read', 'Article'))).toBe(false)

      await asActor(admin.userId, () => authorization.grant({ action: 'create', role: 'admin', target: 'Article' }))
      const article = randomUUID()
      await asActor(admin.userId, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${article}, 'Article', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${article}, 'Private', ${user})
        `
      }))

      await asActor(admin.userId, () => authorization.grant({
        action: 'read',
        predicate: { field: 'owner.id', operator: '$eq', value: { $actor: true } },
        role: 'public',
        target: 'Article',
      }))

      const own = await asActor(user, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(own).toEqual([{ id: article, title: 'Private' }])
      const stranger = await asActor(other, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(stranger).toEqual([])
      const anonymous = await asActor(null, () => server.db.query('Article', {
        fields: ['id', 'title'],
      }))
      expect(anonymous).toEqual([])

      const direct = await asActor(user, () => server.db.tx(async sql => {
        const rows = await sql<{ id: string }[]>`
          SELECT "id"
          FROM "Article"
        `
        return rows
      }))
      expect(direct).toEqual([{ id: article }])

      const forged = await asActor(user, () => server.db.tx(async sql => {
        await sql`
          SELECT set_config('basis.actor', 'deadbeef:9999999999:forged', TRUE)
        `
        return sql<{ id: string }[]>`
          SELECT "id"
          FROM "Article"
        `
      }))
      expect(forged).toEqual([])

      let copied = ''
      await asActor(user, () => server.db.tx(async sql => {
        const [token] = await sql<{ token: string }[]>`
          SELECT current_setting('basis.actor', TRUE) AS token
        `
        copied = token?.token ?? ''
        expect((await sql<{ actor: string | null }[]>`
          SELECT basis.actor_id() AS actor
        `)[0]?.actor).toBe(user)
      }))
      const replayed = await asActor(other, () => server.db.tx(async sql => {
        await sql`
          SELECT set_config('basis.actor', ${copied}, TRUE)
        `
        return sql<{ actor: string | null }[]>`
          SELECT basis.actor_id() AS actor
        `
      }))
      expect(replayed[0]?.actor).toBeNull()

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
        UPDATE "Grant"
        SET "action" = 'manage'
      `))).rejects.toThrow()
      await expect(asActor(other, () => server.db.tx(async sql => sql`
        INSERT INTO "UserRole" ("user.id", "role.id")
        VALUES (${other}, (SELECT "id" FROM "Role" WHERE "key" = 'admin'))
      `))).rejects.toThrow()
      await expect(asActor(admin.userId, () => server.db.tx(async sql => sql`
        UPDATE "Grant"
        SET "action" = 'manage'
      `))).rejects.toThrow()
      await expect(asActor(admin.userId, () => server.db.tx(async sql => sql`
        INSERT INTO "UserRole" ("user.id", "role.id")
        VALUES (${other}, (SELECT "id" FROM "Role" WHERE "key" = 'admin'))
      `))).rejects.toThrow()
      await expect(asActor(admin.userId, () => server.db.tx(async sql => sql`
        SELECT basis.create_grant('admin', 'manage', '*', 'null'::jsonb)
      `))).rejects.toThrow()
      await expect(asActor(admin.userId, () => server.db.tx(async sql => sql`
        SELECT basis.assign_role(${admin.userId}, 'admin')
      `))).rejects.toThrow()
      await expect(asActor(admin.userId, () => authorization.assignRole(admin.userId, 'admin'))).rejects.toThrow()

      const editor = 'editor'
      await asActor(admin.userId, () => authorization.createRole(editor, 'Editor'))
      await asActor(admin.userId, () => authorization.assignRole(other, editor))
      await asActor(admin.userId, () => authorization.grant({
        action: 'read',
        role: editor,
        target: 'Article',
      }))
      await asActor(admin.userId, () => authorization.grant({
        action: 'update',
        role: editor,
        target: 'Article',
      }))
      expect(await asActor(other, () => authorization.can('update', 'Article', { id: article }))).toBe(true)
      const updated = await asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Updated'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(updated).toHaveLength(1)
      await asActor(admin.userId, () => authorization.removeRole(other, editor))
      const deniedAgain = await asActor(other, () => server.db.tx(async sql => sql`
        UPDATE "Article"
        SET "title" = 'Leaked'
        WHERE "id" = ${article}
        RETURNING "id"
      `))
      expect(deniedAgain).toHaveLength(0)

      const limited = 'limited'
      await asActor(admin.userId, () => authorization.createRole(limited, 'Limited'))
      await asActor(admin.userId, () => authorization.assignRole(other, limited))
      await asActor(admin.userId, () => authorization.grant({ action: 'read', role: limited, target: 'Article' }))
      await asActor(admin.userId, () => authorization.grant({
        action: 'update',
        predicate: { field: 'title', operator: '$eq', value: 'Updated' },
        role: limited,
        target: 'Article',
      }))
      await expect(asActor(other, () => server.db.tx(async sql => sql`
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
      await asActor(admin.userId, () => authorization.grant({
        action: 'create',
        predicate: { field: 'id', operator: '$eq', value: allowedId },
        role: 'public',
        target: 'Article',
      }))
      await asActor(user, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${allowedId}, 'Allowed', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${allowedId}, 'Allowed', ${user})
        `
      }))
      await expect(asActor(other, () => server.db.tx(async sql => {
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

      const employeeId = randomUUID()
      const employeeOtherId = randomUUID()
      await asActor(admin.userId, () => authorization.grant({
        action: 'create',
        role: 'admin',
        target: 'Employee',
      }))
      await asActor(admin.userId, () => server.db.tx(async sql => {
        const employees = [
          [employeeId, 'employee@example.com'],
          [employeeOtherId, 'other-employee@example.com'],
        ] as const
        for (const [id, email] of employees) {
          await sql`
            INSERT INTO "Entity" ("id", "name", "entity")
            VALUES (${id}, ${email}, 'Employee')
          `
          await sql`
            INSERT INTO "Profile" ("id", "email")
            VALUES (${id}, ${email})
          `
          await sql`
            INSERT INTO "Employee" ("id")
            VALUES (${id})
          `
        }
      }))
      await asActor(admin.userId, () => authorization.grant({
        action: 'read',
        predicate: { field: 'email', operator: '$eq', value: 'employee@example.com' },
        role: 'public',
        target: 'Employee',
      }))
      const employees = await asActor(other, () => server.db.query('Employee', {
        fields: ['id', 'email'],
      }))
      expect(employees).toEqual([{ email: 'employee@example.com', id: employeeId }])

      const applicationUserId = randomUUID()
      await asActor(admin.userId, () => authorization.grant({
        action: 'create',
        role: 'admin',
        target: 'ApplicationUser',
      }))
      await asActor(admin.userId, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${applicationUserId}, 'Application User', 'ApplicationUser')
        `
        await sql`
          INSERT INTO "User" ("id", "email", "displayName")
          VALUES (${applicationUserId}, 'application@example.com', 'Application User')
        `
        await sql`
          INSERT INTO "ApplicationUser" ("id")
          VALUES (${applicationUserId})
        `
      }))
      await asActor(admin.userId, () => authorization.grant({
        action: 'read',
        predicate: { field: 'email', operator: '$eq', value: 'application@example.com' },
        role: 'public',
        target: 'ApplicationUser',
      }))
      expect(await asActor(other, () => server.db.query('ApplicationUser', {
        fields: ['id', 'email'],
      }))).toEqual([{ email: 'application@example.com', id: applicationUserId }])

      const secretId = randomUUID()
      const literalId = randomUUID()
      await asActor(admin.userId, () => server.db.tx(async sql => {
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${secretId}, 'secret', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${secretId}, 'x-secret', ${admin.userId})
        `
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${literalId}, 'literal', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id")
          VALUES (${literalId}, 'X%Literal', ${admin.userId})
        `
      }))
      await asActor(admin.userId, () => authorization.grant({
        action: 'read',
        predicate: { field: 'title', operator: '$contains', value: 'x%' },
        role: 'public',
        target: 'Article',
      }))
      const contains = await asActor(null, () => server.db.query('Article', { fields: ['id', 'title'] }))
      expect(contains).toEqual([{ id: literalId, title: 'X%Literal' }])

      const parity = await asActor(null, () => server.db.tx(async sql => {
        const [row] = await sql<{
          less: boolean,
          literal: boolean,
          nullMissing: boolean,
          wildcard: boolean,
        }[]>`
          SELECT basis.matches(jsonb_build_object('field',
            'title',
            'operator',
            '$contains',
            'value',
            'x%'),
            jsonb_build_object('title',
            'x-secret') ) AS wildcard,
            basis.matches(jsonb_build_object('field',
            'title',
            'operator',
            '$contains',
            'value',
            'x%'),
            jsonb_build_object('title',
            'X%Literal') ) AS literal,
            basis.matches(jsonb_build_object('field',
            'n',
            'operator',
            '$lt',
            'value',
            2),
            jsonb_build_object('n',
            1) ) AS less,
            basis.matches(jsonb_build_object('field',
            'missing',
            'operator',
            '$eq',
            'value',
            NULL),
            jsonb_build_object('n',
            1) ) AS "nullMissing"
        `
        return row
      }))
      expect(parity).toEqual({ less: true, literal: true, nullMissing: true, wildcard: false })

      const publicGrants = (await asActor(admin.userId, () => authorization.effective(null)))
        .filter(grant => grant.role === 'public' && grant.action === 'read' && grant.target === 'Article')
      if (publicGrants.length === 0) throw new Error('public grant was not created')
      for (const grant of publicGrants) {
        await asActor(admin.userId, () => authorization.revoke(grant.id))
      }
      expect(await asActor(user, () => server.db.query('Article', {
        fields: ['id', 'title'],
      }))).toEqual([])

      await asActor(admin.userId, () => authorization.revokeIdentity('test', 'other'))
      expect(await authorization.resolve(other)).toBeNull()

    } finally {
      await server.shutdown()
      removeService(install)
    }
  }, 120_000)
})
