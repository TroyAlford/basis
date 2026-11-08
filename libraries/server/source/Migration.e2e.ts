import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { useDatabaseFixture } from '../testing/DatabaseFixture'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { EntityDefinitions } from './EntityDefinitions'
import { Graph } from './Graph'
import { DDL } from './Schema'

/**
 * Load one small ordinary schema.
 * @param names - Entity names.
 * @returns Validated definitions.
 */
function model(...names: string[]): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify({
    entities: names.map(name => ({
      fields: [{ field: 'title', type: 'String' }],
      name,
    })),
  }))
}

/**
 * Create a unique version label for one test run.
 * @param label - Stable version prefix.
 * @returns The unique version.
 */
function migrationVersion(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`
}

describe('Reviewed schema evolution', () => {
  test('applies a reviewed artifact, records it once, verifies readiness, and rejects drift', async () => {
    const desired = model('Note')
    await withIsolatedDatabase('migration-apply', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired })
      const attemptVersion = migrationVersion('001-note')
      const artifact = DDL.review(plan, { schema: database.schema, version: attemptVersion })
      const identical = DDL.review(plan, { schema: database.schema, version: attemptVersion })
      expect(identical.checksum).toBe(artifact.checksum)
      expect(artifact.operations.length).toBeGreaterThan(0)

      const applied = await DDL.apply(database.sql, artifact)
      expect(applied.applied).toBe(true)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      expect(applied.version).toBe(attemptVersion)

      const [ledger] = await database.sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM basis.schema_migration
        WHERE checksum = ${artifact.checksum}
      `
      expect(ledger?.count).toBe(1)

      const readiness = await DDL.readiness(database.sql, artifact)
      expect(readiness.ready).toBe(true)
      expect(readiness.discrepancies).toEqual([])
      await database.sql.unsafe(
        'DROP FUNCTION IF EXISTS basis.has_role(text) CASCADE; ' +
        'DROP FUNCTION IF EXISTS basis.resolve_identity(text) CASCADE; ' +
        'DROP FUNCTION IF EXISTS basis.enroll_identity(text, text, text, text) CASCADE',
      ).simple()

      const [afterApply] = await database.sql<{ present: boolean }[]>`
        SELECT to_regclass(${`"${database.schema}"."Note"`}) IS NOT NULL AS present
      `
      expect(afterApply?.present).toBe(true)
      const noopPlan = DDL.plan({
        actual: await DDL.introspect(database.sql),
        desired,
        previousPhysical: desired.physicalSchema('basis_app', false),
      })
      const duplicateVersion = DDL.review(noopPlan, {
        schema: database.schema,
        version: attemptVersion,
      })
      expect(duplicateVersion.checksum).not.toBe(artifact.checksum)
      await expect(DDL.apply(database.sql, duplicateVersion)).rejects.toThrow('already applied')
      await expect(DDL.apply(database.sql, artifact)).rejects.toThrow('already applied')
      const tampered = {
        ...artifact,
        operations: [...artifact.operations, {
          dependsOn: [],
          id: 'tampered',
          kind: 'table' as const,
          risk: 'review' as const,
          sql: 'SELECT 1',
          target: 'tampered',
        }],
      }
      await expect(DDL.apply(database.sql, tampered)).rejects.toThrow('checksum')
      await expect(DDL.apply(database.sql, { ...artifact, planHash: 'tampered' }))
        .rejects.toThrow('checksum')
      await database.sql.unsafe('ALTER TABLE "Note" ADD COLUMN "extra" text').simple()
      const drifted = await DDL.readiness(database.sql, artifact)
      expect(drifted.ready).toBe(false)
      expect(drifted.discrepancies.length).toBeGreaterThan(0)
    }, { fresh: true })
  }, 120_000)

  test('requires an explicit approved resolution for a rename ambiguity', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'OldNote' }],
    }))
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'NewNote' }],
    }))
    await withIsolatedDatabase('migration-rename', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const first = DDL.review(DDL.plan({ actual: empty, desired: previous }), {
        schema: database.schema,
        version: migrationVersion('001-old'),
      })
      await DDL.apply(database.sql, first)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        desired,
        previous,
        previousPhysical: previous.physicalSchema('basis_app', false),
      })
      expect(plan.ambiguities).toContain('OldNote -> NewNote')
      expect(() => DDL.review(plan, { schema: database.schema, version: migrationVersion('002-new') }))
        .toThrow('requires an explicit approved rename SQL resolution')
      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: 'rename:OldNote -> NewNote',
          sql: 'ALTER TABLE "OldNote" RENAME TO "NewNote"',
        }],
        schema: database.schema,
        version: migrationVersion('002-new'),
      })
      expect(artifact.operations.some(operation => operation.id === 'rename:OldNote -> NewNote'))
        .toBe(true)
    }, { fresh: true })
  }, 120_000)

  test('applies an additive transition from a reviewed previous artifact', async () => {
    const previous = model('Note')
    const desired = model('Note', 'Tag')
    await withIsolatedDatabase('migration-additive', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const first = DDL.review(DDL.plan({ actual: empty, desired: previous }), {
        schema: database.schema,
        version: migrationVersion('001-note'),
      })
      await DDL.apply(database.sql, first)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()

      const actual = await DDL.introspect(database.sql)
      const previousPhysical = previous.physicalSchema('basis_app', false)
      const plan = DDL.plan({
        actual,
        desired,
        previous,
        previousPhysical,
      })
      expect(plan.blocked).toBe(false)
      const second = DDL.review(plan, { schema: database.schema, version: migrationVersion('002-tag') })
      await DDL.apply(database.sql, second)
      expect((await DDL.readiness(database.sql, second)).ready).toBe(true)
    }, { fresh: true })
  }, 120_000)

  test('applies and verifies a Graph security schema', async () => {
    await withIsolatedDatabase('migration-graph', async database => {
      const appRole = `basis_graph_app_${randomUUID().replaceAll('-', '').slice(0, 12)}`
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      const graph = new Graph({
        entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
        grants: [{ action: 'read', role: 'public', target: 'Note' }],
        schema: database.schema,
      })
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const expected = graph.physicalSchema(appRole, false)
      const plan = DDL.plan({
        actual: empty,
        appRole,
        desired: { physicalSchema: () => expected },
      })
      const artifact = DDL.review(plan, {
        appRole,
        schema: database.schema,
        version: migrationVersion('001-graph'),
      })
      await DDL.apply(database.sql, artifact)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const readiness = await DDL.readiness(database.sql, artifact)
      expect(readiness.ready).toBe(true)
      expect(readiness.discrepancies).toEqual([])
    }, { fresh: true })
  }, 120_000)

  test('applies and verifies an MTI transition', async () => {
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
        { extends: 'Profile', fields: [], name: 'Employee' },
      ],
    }))
    await withIsolatedDatabase('migration-mti', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const artifact = DDL.review(DDL.plan({ actual: empty, desired }), {
        schema: database.schema,
        version: migrationVersion('001-mti'),
      })
      await DDL.apply(database.sql, artifact)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      expect((await DDL.readiness(database.sql, artifact)).ready).toBe(true)
    }, { fresh: true })
  }, 120_000)

  test('requires an explicit approved SQL resolution for a data operation', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'amount', type: 'String' }], name: 'Note' }],
    }))
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'amount', type: 'Number' }], name: 'Note' }],
    }))
    await withIsolatedDatabase('migration-data', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const first = DDL.review(DDL.plan({ actual: empty, desired: previous }), {
        schema: database.schema,
        version: migrationVersion('001-note'),
      })
      await DDL.apply(database.sql, first)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()

      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        desired,
        previous,
        previousPhysical: previous.physicalSchema('basis_app', false),
      })
      expect(plan.operations.some(operation => (
        operation.kind === 'alter-column' && operation.risk === 'data'
      ))).toBe(true)
      expect(() => DDL.review(plan, { schema: database.schema, version: migrationVersion('002-number') }))
        .toThrow('explicit approved SQL resolution')

      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: plan.operations.find(operation => operation.kind === 'alter-column')?.id,
          sql: 'ALTER TABLE "Note" ALTER COLUMN "amount" TYPE double precision ' +
            'USING "amount"::double precision',
        }],
        schema: database.schema,
        version: migrationVersion('002-number'),
      })
      await DDL.apply(database.sql, artifact)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      expect((await DDL.readiness(database.sql, artifact)).ready).toBe(true)
    }, { fresh: true })
  }, 120_000)

  test('rolls back an interrupted migration before writing the ledger', async () => {
    const desired = model('Note')
    await withIsolatedDatabase('migration-interrupted', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual: empty, desired })
      const failing = plan.operations.find(operation => (
        operation.kind === 'constraint' || operation.kind === 'trigger'
      ))
      if (!failing) throw new Error('migration plan did not contain a later operation')
      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: failing.id,
          sql: 'SELECT * FROM "does_not_exist"',
        }],
        schema: database.schema,
        version: migrationVersion('001-note'),
      })
      await expect(DDL.apply(database.sql, artifact)).rejects.toThrow()
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const [ledger] = await database.sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM basis.schema_migration
        WHERE checksum = ${artifact.checksum}
      `
      expect(ledger?.count).toBe(0)
      const [table] = await database.sql<{ present: boolean }[]>`
        SELECT to_regclass(${`"${database.schema}"."Note"`}) IS NOT NULL AS present
      `
      expect(table?.present).toBe(false)
    }, { fresh: true })
  }, 120_000)

  test('applies a CONCURRENTLY operation through a reserved pooled session', async () => {
    const fixture = await useDatabaseFixture('migration-concurrent')
    const schema = `migration_concurrent_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const admin = fixture.server.db.sql
    await admin.unsafe(`CREATE SCHEMA "${schema}"`).simple()
    try {
      const reserved = await admin.reserve()
      await reserved.unsafe(`SET search_path TO "${schema}"`).simple()
      const actual = await DDL.introspect(reserved)
      reserved.release()
      const desired = model('Note')
      const plan = DDL.plan({ actual, desired })
      const index = plan.operations.find(operation => operation.kind === 'index')
      if (!index) throw new Error('migration plan did not contain an index')
      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: index.id,
          sql: index.sql.replace(/^CREATE INDEX/u, 'CREATE INDEX CONCURRENTLY'),
        }],
        schema,
        version: migrationVersion('001-concurrent'),
      })
      const applied = await DDL.apply(admin, artifact)
      expect(applied.applied).toBe(true)
      expect((await DDL.readiness(admin, artifact)).ready).toBe(true)
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).simple()
    }
  }, 120_000)

  test('records a failed nontransactional migration without claiming readiness', async () => {
    const fixture = await useDatabaseFixture('migration-concurrent-failure')
    const schema = `migration_concurrent_fail_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const admin = fixture.server.db.sql
    await admin.unsafe(`CREATE SCHEMA "${schema}"`).simple()
    try {
      const reserved = await admin.reserve()
      await reserved.unsafe(`SET search_path TO "${schema}"`).simple()
      const actual = await DDL.introspect(reserved)
      reserved.release()
      const plan = DDL.plan({ actual, desired: model('Note') })
      const index = plan.operations.find(operation => operation.kind === 'index')
      if (!index) throw new Error('migration plan did not contain an index')
      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: index.id,
          sql: 'CREATE INDEX CONCURRENTLY "migration_missing_idx" ON "Missing" ("id")',
        }],
        schema,
        version: migrationVersion('001-concurrent-fail'),
      })
      await expect(DDL.apply(admin, artifact)).rejects.toThrow()
      const [ledger] = await admin<{ status: string }[]>`
        SELECT status FROM basis.schema_migration WHERE checksum = ${artifact.checksum}
      `
      expect(ledger?.status).toBe('failed')
      expect((await DDL.readiness(admin, artifact)).ready).toBe(false)
    } finally {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).simple()
    }
  }, 120_000)

  test('rejects application when the live source drifted from the approved plan', async () => {
    const desired = model('Note')
    await withIsolatedDatabase('migration-drift', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const artifact = DDL.review(DDL.plan({ actual: empty, desired }), {
        schema: database.schema,
        version: migrationVersion('001-note'),
      })
      await database.sql.unsafe('CREATE TABLE "Unapproved" ("id" text PRIMARY KEY)').simple()
      await expect(DDL.apply(database.sql, artifact)).rejects.toThrow('drifted')
    }, { fresh: true })
  }, 120_000)
})
