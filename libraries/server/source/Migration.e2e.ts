import { describe, expect, test } from 'bun:test'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { EntityDefinitions } from './EntityDefinitions'
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

describe('Reviewed schema evolution', () => {
  test('applies a reviewed artifact, records it once, verifies readiness, and rejects drift', async () => {
    const desired = model('Note')
    await withIsolatedDatabase('migration-apply', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired })
      const artifact = DDL.review(plan, { schema: database.schema, version: '001-note' })
      expect(artifact.operations.length).toBeGreaterThan(0)

      const applied = await DDL.apply(database.sql, artifact)
      expect(applied.applied).toBe(true)
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      expect(applied.version).toBe('001-note')

      const [ledger] = await database.sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM basis.schema_migration
        WHERE checksum = ${artifact.checksum}
      `
      expect(ledger?.count).toBe(1)

      const readiness = await DDL.readiness(database.sql, artifact)
      expect(readiness.ready).toBe(true)
      expect(readiness.discrepancies).toEqual([])

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
      await database.sql.unsafe('ALTER TABLE "Note" ADD COLUMN "extra" text').simple()
      const drifted = await DDL.readiness(database.sql, artifact)
      expect(drifted.ready).toBe(false)
      expect(drifted.discrepancies.length).toBeGreaterThan(0)
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
        version: '001-note',
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
      const second = DDL.review(plan, { schema: database.schema, version: '002-tag' })
      await DDL.apply(database.sql, second)
      expect((await DDL.readiness(database.sql, second)).ready).toBe(true)
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
        version: '001-note',
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
      expect(() => DDL.review(plan, { schema: database.schema, version: '002-number' }))
        .toThrow('explicit approved SQL resolution')

      const artifact = DDL.review(plan, {
        resolutions: [{
          approved: true,
          operationId: plan.operations.find(operation => operation.kind === 'alter-column')?.id,
          sql: 'ALTER TABLE "Note" ALTER COLUMN "amount" TYPE double precision ' +
            'USING "amount"::double precision',
        }],
        schema: database.schema,
        version: '002-number',
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
      const artifact = DDL.review(DDL.plan({ actual: empty, desired }), {
        schema: database.schema,
        version: '001-note',
      })
      const broken = {
        ...artifact,
        operations: [{
          dependsOn: [],
          id: 'broken:missing-table',
          kind: 'table' as const,
          risk: 'review' as const,
          sql: 'CREATE TABLE "Broken" ("id" text)',
          target: 'Broken',
        }, {
          dependsOn: [],
          id: 'broken:invalid',
          kind: 'table' as const,
          risk: 'review' as const,
          sql: 'SELECT * FROM "does_not_exist"',
          target: 'invalid',
        }],
      }
      await expect(DDL.apply(database.sql, broken)).rejects.toThrow()
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const [ledger] = await database.sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM basis.schema_migration
        WHERE checksum = ${artifact.checksum}
      `
      expect(ledger?.count).toBe(0)
    }, { fresh: true })
  }, 120_000)

  test('rejects application when the live source drifted from the approved plan', async () => {
    const desired = model('Note')
    await withIsolatedDatabase('migration-drift', async database => {
      await database.sql.unsafe(`SET search_path TO "${database.schema}"`).simple()
      const empty = await DDL.introspect(database.sql)
      const artifact = DDL.review(DDL.plan({ actual: empty, desired }), {
        schema: database.schema,
        version: '001-note',
      })
      await database.sql.unsafe('CREATE TABLE "Unapproved" ("id" text PRIMARY KEY)').simple()
      await expect(DDL.apply(database.sql, artifact)).rejects.toThrow('drifted')
    }, { fresh: true })
  }, 120_000)
})
