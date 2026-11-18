import { Graph } from 'basis/server'
import type { WithDatabaseOptions } from 'basis/testing'
import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withDatabase as withInternalDatabase } from '../testing/DatabaseFixture'
import { withLifecycleDatabase } from '../testing/DatabaseLifecycle'
import { installBasis } from './Schema'

const owner = '00000000-0000-4000-8000-000000000201'
const viewer = '00000000-0000-4000-8000-000000000202'
const workspace = '00000000-0000-4000-8000-000000000203'

const graph = new Graph({
  entities: [
    { fields: [], name: 'Workspace' },
    {
      fields: [{ field: 'workspace', nullable: false, target: 'Workspace', type: 'Entity' }],
      name: 'Resource',
      security: {
        create: { where: 'workspace.members $contains (id = $me and workspaceMembership.role = "owner")' },
        read: { where: 'workspace.members $contains (id = $me and workspaceMembership.role = "owner")' },
      },
    },
  ],
  relationships: [{
    between: [
      { field: 'workspace', inverse: 'members', target: 'Workspace' },
      { field: 'user', inverse: 'workspaces', target: 'User' },
    ],
    fields: [{ field: 'role', type: 'String' }],
    name: 'WorkspaceMembership',
  }],
})

const options = {
  graph,
  setup: async database => {
    await database.create('User', { id: owner, name: 'Owner' })
    await database.create('User', { id: viewer, name: 'Viewer' })
    await database.create('Workspace', { id: workspace, name: 'Workspace' })
    await database.sql`
      INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", role)
      VALUES
        (${workspace}, ${owner}, 'owner'),
        (${workspace}, ${viewer}, 'viewer')
    `
  },
}

test('custom Graph fixtures install app-role RLS and select an actor', async () => {
  await withDatabase('custom-graph-owner', owner, async database => {
    expect(await database.create('Resource', { name: 'Owner resource', workspace }))
      .toMatchObject({ created: 1 })
  }, options)

  await expect(withDatabase('custom-graph-viewer', viewer, async database => {
    await database.create('Resource', { name: 'Viewer resource', workspace })
  }, options)).rejects.toThrow(/row-level security|authorization/i)
})

test('asOwner swaps role and exposes the same fixture context', async () => {
  await withInternalDatabase('custom-graph-owner-api', owner, async database => {
    const appRole = await database.sql<{ role: string }[]>`
      SELECT CURRENT_ROLE AS role
    `
    expect(appRole[0]?.role).toBe('basis_app')
    const schema = database.schema

    await database.asOwner(async ownerDatabase => {
      expect(ownerDatabase.schema).toBe(schema)
      const ownerRole = await ownerDatabase.sql<{ role: string }[]>`SELECT current_role AS role`
      expect(ownerRole[0]?.role).not.toBe('basis_app')

      await ownerDatabase.sql`CREATE TABLE "OwnerApiProof" ("id" uuid PRIMARY KEY)`
      await ownerDatabase.tx(async () => {
        await ownerDatabase.sql`INSERT INTO "OwnerApiProof" ("id") VALUES (gen_random_uuid())`
      })
      const [rolledBack] = await ownerDatabase.sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "OwnerApiProof"
      `
      expect(rolledBack?.count).toBe(0)
      await ownerDatabase.sql`DROP TABLE "OwnerApiProof"`
    })

    const restored = await database.sql<{ role: string }[]>`
      SELECT CURRENT_ROLE AS role
    `
    expect(restored[0]?.role).toBe('basis_app')
  }, options)
})

describe('Public database fixture isolation', () => {
  test('does not expose committed-write or owner-proof options to consumers', () => {
    const accept = (candidate: WithDatabaseOptions): WithDatabaseOptions => candidate
    expect(accept({ graph })).toBeDefined()
    // @ts-expect-error commit is an internal proof option.
    accept({ commit: true })
    // @ts-expect-error owner is an internal proof option.
    accept({ owner: true })
    // @ts-expect-error fresh is an internal proof option.
    accept({ fresh: true })
    // @ts-expect-error entities is an internal proof option.
    accept({ entities: {} })
  })

  test('runs both public overloads as the restricted application role', async () => {
    await withDatabase('public-overload-callback', async database => {
      const [role] = await database.sql<{ role: string }[]>`
        SELECT CURRENT_ROLE AS role
      `
      expect(role?.role).toBe('basis_app')
    })
    await withDatabase('public-overload-actor', null, async database => {
      const [role] = await database.sql<{ role: string }[]>`
        SELECT CURRENT_ROLE AS role
      `
      expect(role?.role).toBe('basis_app')
    })
  })

  test('rolls back writes from the callback-only overload', async () => {
    const label = `public-inline-rollback-${randomUUID()}`
    await withDatabase('public-inline-rollback-write', async database => {
      await database.create('Owner', { label, name: label })
      expect(await database.query('Owner', { fields: ['id'], where: { label } }))
        .toHaveLength(1)
    })
    await withDatabase('public-inline-rollback-read', null, async database => {
      expect(await database.query('Owner', { fields: ['id'], where: { label } }))
        .toHaveLength(0)
    })
  })

  test('does not expose privileged owner switching', async () => {
    await withDatabase('public-owner-context', null, async database => {
      expect('asOwner' in database).toBe(false)
      // @ts-expect-error asOwner is reserved for internal owner proofs.
      expect(database.asOwner).toBeUndefined()
    })
  })

  test('rolls back owner setup before the next consumer test', async () => {
    const label = `public-owner-setup-${randomUUID()}`
    await withDatabase('public-owner-setup-write', null, async database => {
      expect(await database.query('Owner', { fields: ['id'], where: { label } }))
        .toHaveLength(1)
    }, {
      setup: async ownerDatabase => {
        await ownerDatabase.create('Owner', { label, name: label })
      },
    })
    await withDatabase('public-owner-setup-read', null, async database => {
      expect(await database.query('Owner', { fields: ['id'], where: { label } }))
        .toHaveLength(0)
    })
  })

  test('always rolls back a consumer withDatabase transaction', async () => {
    const title = `public-rollback-${randomUUID()}`
    await withDatabase('public-rollback-write', null, async database => {
      await database.create('Owner', { label: title, name: title })
      expect(await database.query('Owner', { fields: ['id'], where: { label: title } }))
        .toHaveLength(1)
    })
    await withDatabase('public-rollback-read', null, async database => {
      expect(await database.query('Owner', { fields: ['id'], where: { label: title } }))
        .toHaveLength(0)
    })

    const forcedTitle = `${title}-forced`
    await withDatabase('public-rollback-forced-write', null, async database => {
      await database.create('Owner', { label: forcedTitle, name: forcedTitle })
    }, { commit: true } as never)
    await withDatabase('public-rollback-forced-read', null, async database => {
      expect(await database.query('Owner', { fields: ['id'], where: { label: forcedTitle } }))
        .toHaveLength(0)
    })
  })
})

describe('Basis substrate installation', () => {
  test('preserves unrelated application-owned triggers', async () => {
    await withLifecycleDatabase('substrate-preserve-trigger', async database => {
      await database.sql`
        CREATE TABLE "Invoice" (
          id TEXT PRIMARY KEY,
          status TEXT
        )
      `
      await database.sql.unsafe(`
        CREATE FUNCTION "resolve_invoice_status"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          NEW."status" := 'resolved';
          RETURN NEW;
        END $$;
      `).simple()
      await database.sql`
        CREATE TRIGGER resolve_invoice_status
        BEFORE INSERT ON "Invoice"
        FOR EACH ROW
        EXECUTE FUNCTION resolve_invoice_status()
      `
      await installBasis(database.sql)
      await database.sql`
        INSERT INTO "Invoice" (id)
        VALUES
          ('invoice-1')
      `
      expect(await database.sql<{ status: string }[]>`
        SELECT "status"
        FROM "Invoice"
      `)
        .toEqual([{ status: 'resolved' }])
      expect(await database.sql<{ present: boolean }[]>`
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_trigger trigger
            JOIN pg_class relation ON relation.oid = TRIGGER.tgrelid
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND relation.relname = 'Invoice'
              AND TRIGGER.tgname = 'resolve_invoice_status'
          ) AS present
      `).toEqual([{ present: true }])
    })
  })

  test('removes only explicitly identified legacy Basis identity objects', async () => {
    await withLifecycleDatabase('substrate-remove-legacy', async database => {
      await database.sql`
        CREATE TABLE "Invoice" (
          id TEXT PRIMARY KEY,
          status TEXT
        )
      `
      await database.sql.unsafe(`
        CREATE FUNCTION "resolve_invoice_status"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          NEW."status" := 'resolved';
          RETURN NEW;
        END $$;
      `).simple()
      await database.sql`
        CREATE TRIGGER resolve_invoice_status
        BEFORE INSERT ON "Invoice"
        FOR EACH ROW
        EXECUTE FUNCTION resolve_invoice_status()
      `
      await database.sql.unsafe(`
        CREATE OR REPLACE FUNCTION basis.enroll_identity(
          provider_name text,
          provider_subject text,
          display_name text,
          email_address text
        ) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
      `).simple()
      await database.sql.unsafe(`
        CREATE OR REPLACE FUNCTION basis.resolve_identity(candidate text)
        RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
      `).simple()
      await database.sql.unsafe(`
        CREATE OR REPLACE FUNCTION basis.has_role(role_id text)
        RETURNS boolean LANGUAGE sql AS $$ SELECT FALSE $$;
      `).simple()
      await installBasis(database.sql)
      expect(await database.sql<{
        enroll: boolean,
        resolve: boolean,
        role: boolean,
        triggerFunction: boolean,
      }[]>`
        SELECT
          TO_REGPROCEDURE('basis.enroll_identity(text,text,text,text)') IS NULL AS enroll,
          TO_REGPROCEDURE('basis.resolve_identity(text)') IS NULL AS resolve,
          TO_REGPROCEDURE('basis.has_role(text)') IS NULL AS role,
          TO_REGPROCEDURE('resolve_invoice_status()') IS NOT NULL AS "triggerFunction"
      `).toEqual([{ enroll: true, resolve: true, role: true, triggerFunction: true }])
      expect(await database.sql<{ present: boolean }[]>`
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_trigger trigger
            JOIN pg_class relation ON relation.oid = TRIGGER.tgrelid
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = current_schema()
              AND relation.relname = 'Invoice'
              AND TRIGGER.tgname = 'resolve_invoice_status'
          ) AS present
      `).toEqual([{ present: true }])
      await database.sql`
        INSERT INTO "Invoice" (id)
        VALUES
          ('invoice-2')
      `
      expect(await database.sql<{ status: string }[]>`
        SELECT "status"
        FROM "Invoice"
      `)
        .toEqual([{ status: 'resolved' }])
    })
  })
})
