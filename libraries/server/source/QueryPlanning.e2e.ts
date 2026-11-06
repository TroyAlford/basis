import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { IsolatedDatabase } from '../testing/DatabaseIsolation'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        {
          cardinality: 'Many',
          field: 'pets',
          inverse: 'owner',
          target: 'Pet',
          type: 'Inverse',
        },
      ],
      name: 'Person',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
      ],
      name: 'Pet',
    },
  ],
}))

/** One measured SQL variant. */
interface MeasuredPlan {
  /** Root inclusive shared hit/read blocks. */
  readonly buffers: number,
  /** Execution time in milliseconds. */
  readonly execution: number,
  /** Name of the rendering strategy. */
  readonly name: string,
  /** Number of plan nodes visited. */
  readonly nodes: number,
  /** Planning time in milliseconds. */
  readonly planning: number,
  /** Top-level actual row count. */
  readonly rows: number,
  /** SQL text size in bytes. */
  readonly sqlBytes: number,
  /** Root inclusive temporary read/write blocks. */
  readonly temp: number,
}

/**
 * Extract the first PostgreSQL JSON plan document.
 * @param row - First `EXPLAIN` row.
 * @returns The plan document.
 */
function planDocument(row: Record<string, unknown> | undefined): {
  readonly 'Execution Time': number,
  readonly 'Plan': Readonly<Record<string, unknown>>,
  readonly 'Planning Time': number,
} {
  const raw = row ? Object.values(row)[0] : undefined
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
  const document = Array.isArray(parsed) ? parsed[0] : parsed
  if (!document || typeof document !== 'object') throw new Error('EXPLAIN did not return a JSON plan')
  return document as {
    readonly 'Execution Time': number,
    readonly 'Plan': Readonly<Record<string, unknown>>,
    readonly 'Planning Time': number,
  }
}

/**
 * Count plan nodes in one PostgreSQL JSON plan tree.
 * @param plan - PostgreSQL plan node.
 * @returns Number of nodes.
 */
function planNodeCount(plan: Readonly<Record<string, unknown>>): number {
  const children = Array.isArray(plan.Plans) ? plan.Plans as readonly Readonly<Record<string, unknown>>[] : []
  return 1 + children.reduce((total, child) => total + planNodeCount(child), 0)
}

/**
 * Measure one SQL statement with planning and buffer statistics.
 * @param database - Isolated PostgreSQL database.
 * @param name - Rendering strategy name.
 * @param sql - Statement to explain and execute.
 * @param values - Bound parameters.
 * @returns Plan timings and top-level row count.
 */
async function measure(
  database: IsolatedDatabase,
  name: string,
  sql: string,
  values: readonly unknown[] = [],
): Promise<MeasuredPlan> {
  const rows = await database.sql.unsafe<Record<string, unknown>[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    [...values],
  )
  const document = planDocument(rows[0])
  const plan = document.Plan
  return {
    buffers: Number(plan['Shared Hit Blocks'] ?? 0) + Number(plan['Shared Read Blocks'] ?? 0),
    execution: document['Execution Time'],
    name,
    nodes: planNodeCount(plan),
    planning: document['Planning Time'],
    rows: Number(plan['Actual Rows'] ?? 0),
    sqlBytes: Buffer.byteLength(sql),
    temp: Number(plan['Temp Read Blocks'] ?? 0) + Number(plan['Temp Written Blocks'] ?? 0),
  }
}

describe('Query planning', () => {
  test('measures correlated and CTE count strategies on representative parents and children', async () => {
    await withIsolatedDatabase('query-planning', async database => {
      await definitions.createTables(database.sql)
      const people = Array.from({ length: 24 }, () => randomUUID())
      const entities = people.map((id, index) => ({
        id,
        name: `person-${String(index).padStart(6, '0')}`,
      }))
      for (const [index, { id, name }] of entities.entries()) {
        await database.sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${id}, ${name}, 'Person')
        `
        await database.sql`
          INSERT INTO "Person" ("id", "title")
          VALUES (${id}, ${`Person ${index}`})
        `
      }
      const pets = people.flatMap((owner, personIndex) => (
        Array.from({ length: (personIndex % 5) + 1 }, (_, petIndex) => ({
          id: randomUUID(),
          owner,
          title: `Pet ${personIndex}-${petIndex}`,
        }))
      ))
      for (const pet of pets) {
        await database.sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${pet.id}, ${pet.title}, 'Pet')
        `
        await database.sql`
          INSERT INTO "Pet" ("id", "title", "owner.id")
          VALUES (${pet.id}, ${pet.title}, ${pet.owner})
        `
      }

      await database.sql`
        ANALYZE "Person"
      `
      await database.sql`
        ANALYZE "Pet"
      `

      const countCte = (modifier: string, threshold: number, parentId?: string) => `
        WITH pet_counts AS ${modifier} (
          SELECT "owner.id" AS "owner_id", count(*)::int AS "total"
          FROM "Pet"
          GROUP BY "owner.id"
        )
        SELECT t."id" AS "id"
        FROM "Person" t
        LEFT JOIN pet_counts c ON c."owner_id" = t."id"
        WHERE ${parentId ? `t."id" = '${parentId}' AND ` : ''}COALESCE(c."total", 0) >= ${threshold}
        ORDER BY t."id" ASC
        LIMIT 25
      `
      const correlatedSql = (threshold: number, parentId?: string) => `
        SELECT t."id" AS "id"
        FROM "Person" t
        WHERE ${parentId ? `t."id" = '${parentId}' AND ` : ''}
          (SELECT count(*)::int FROM "Pet" WHERE "owner.id" = t."id") >= ${threshold}
        ORDER BY t."id" ASC
        LIMIT 25
      `
      const allMetrics: MeasuredPlan[] = []
      for (const threshold of [1, 2, 4]) {
        const production = compileEntityQuery(definitions, 'Person', {
          fields: ['id'],
          limit: 25,
          orderBy: 'id',
          where: `pets.$count >= ${threshold}`,
        })
        const variants = [
          {
            name: `production@${threshold}`,
            sql: production.sql,
            values: production.values,
          },
          { name: `correlated@${threshold}`, sql: correlatedSql(threshold), values: [] },
          { name: `cte-default@${threshold}`, sql: countCte('', threshold), values: [] },
          { name: `cte-materialized@${threshold}`, sql: countCte('MATERIALIZED', threshold), values: [] },
          { name: `cte-not-materialized@${threshold}`, sql: countCte('NOT MATERIALIZED', threshold), values: [] },
        ]
        const results = []
        const metrics: MeasuredPlan[] = []
        for (const variant of variants) {
          const rows = await database.sql.unsafe<{ id: string }[]>(variant.sql, [...variant.values])
          results.push(rows.map(row => row.id))
          metrics.push(await measure(database, variant.name, variant.sql, variant.values))
        }
        expect(results.every(ids => ids.join(',') === results[0]?.join(','))).toBe(true)
        expect(results[0]?.length).toBeGreaterThanOrEqual(threshold === 1 ? 1 : 0)
        allMetrics.push(...metrics)
      }
      expect(allMetrics).toHaveLength(15)
      for (const metric of allMetrics) {
        expect(metric.planning).toBeGreaterThanOrEqual(0)
        expect(metric.execution).toBeGreaterThanOrEqual(0)
        expect(metric.rows).toBeGreaterThanOrEqual(0)
        expect(metric.buffers).toBeGreaterThanOrEqual(0)
        expect(metric.temp).toBeGreaterThanOrEqual(0)
        expect(metric.nodes).toBeGreaterThan(0)
        expect(metric.sqlBytes).toBeGreaterThan(0)
      }
      expect(allMetrics.map(metric => metric.name)).toContain('production@1')
      expect(allMetrics.map(metric => metric.name)).toContain('correlated@1')
      expect(allMetrics.map(metric => metric.name)).toContain('cte-materialized@4')

      const selectiveParent = people[0] as string
      const selectiveProduction = compileEntityQuery(definitions, 'Person', {
        fields: ['id'],
        limit: 25,
        orderBy: 'id',
        where: `id = '${selectiveParent}' $and pets.$count >= 2`,
      })
      const selectiveVariants = [
        { name: 'selective-production@2', sql: selectiveProduction.sql, values: selectiveProduction.values },
        { name: 'selective-correlated@2', sql: correlatedSql(2, selectiveParent), values: [] },
        { name: 'selective-cte-default@2', sql: countCte('', 2, selectiveParent), values: [] },
        { name: 'selective-cte-materialized@2', sql: countCte('MATERIALIZED', 2, selectiveParent), values: [] },
        { name: 'selective-cte-not-materialized@2', sql: countCte('NOT MATERIALIZED', 2, selectiveParent), values: [] },
      ]
      const selectiveResults = []
      for (const variant of selectiveVariants) {
        const rows = await database.sql.unsafe<{ id: string }[]>(variant.sql, [...variant.values])
        selectiveResults.push(rows.map(row => row.id))
        allMetrics.push(await measure(database, variant.name, variant.sql, variant.values))
      }
      expect(selectiveResults.every(ids => ids.join(',') === selectiveResults[0]?.join(','))).toBe(true)

      await database.sql`
        DROP INDEX "Pet_owner_fk_idx"
      `
      const unindexed = [
        {
          name: 'unindexed-production@2',
          sql: selectiveProduction.sql,
          values: selectiveProduction.values,
        },
        { name: 'unindexed-cte-default@2', sql: countCte('', 2, selectiveParent), values: [] },
      ]
      const unindexedResults = []
      for (const variant of unindexed) {
        const rows = await database.sql.unsafe<{ id: string }[]>(variant.sql, [...variant.values])
        unindexedResults.push(rows.map(row => row.id))
        allMetrics.push(await measure(database, variant.name, variant.sql, variant.values))
      }
      expect(unindexedResults.every(ids => ids.join(',') === unindexedResults[0]?.join(','))).toBe(true)
      expect(allMetrics).toHaveLength(22)
      process.stdout.write(`query-plan-evidence ${JSON.stringify(allMetrics)}\n`)

      const projected = await queryEntity<{
        'id': string,
        'pets': { items: unknown[], remaining: number, total: number },
        'pets.$count': number,
      }>(
        database.sql,
        definitions,
        'Person',
        {
          collections: { pets: { limit: 1 } },
          fields: ['id', 'pets.$count', 'pets'],
          orderBy: 'id',
          where: 'pets.$count >= 2',
        },
      )
      expect(projected.every(row => row['pets.$count'] >= 2)).toBe(true)
      expect(projected.every(row => row.pets.total >= 2)).toBe(true)
      expect(projected.every(row => row.pets.items.length <= 1)).toBe(true)
    })
  }, 120_000)

  test('keeps sibling descendant reference plans on their own parent alias', async () => {
    const variantDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [], name: 'Source' },
        {
          extends: 'Source',
          fields: [{ field: 'favorite', target: 'Target', type: 'Entity' }],
          name: 'Alpha',
        },
        {
          extends: 'Source',
          fields: [{ field: 'favorite', target: 'Target', type: 'Entity' }],
          name: 'Beta',
        },
        {
          fields: [{
            cardinality: 'Many',
            field: 'pets',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }],
          name: 'Target',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pets', target: 'Target', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    }))
    await withIsolatedDatabase('query-planning-variants', async database => {
      await variantDefinitions.createTables(database.sql)
      const alpha = '00000000-0000-4000-8000-000000000001'
      const beta = '00000000-0000-4000-8000-000000000002'
      const targetA = '00000000-0000-4000-8000-000000000011'
      const targetB = '00000000-0000-4000-8000-000000000012'
      const petA1 = '00000000-0000-4000-8000-000000000021'
      const petA2 = '00000000-0000-4000-8000-000000000022'
      const petB = '00000000-0000-4000-8000-000000000023'
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${alpha},
          'Alpha',
          'Alpha'),
          (${beta},
          'Beta',
          'Beta'),
          (${targetA},
          'Target A',
          'Target'),
          (${targetB},
          'Target B',
          'Target'),
          (${petA1},
          'Pet A1',
          'Pet'),
          (${petA2},
          'Pet A2',
          'Pet'),
          (${petB},
          'Pet B',
          'Pet')
      `
      await database.sql`
        INSERT INTO "Source" ("id")
        VALUES (${alpha}), (${beta})
      `
      await database.sql`
        INSERT INTO "Target" ("id")
        VALUES (${targetA}), (${targetB})
      `
      await database.sql`
        INSERT INTO "Alpha" ("id", "favorite.id")
        VALUES (${alpha}, ${targetA})
      `
      await database.sql`
        INSERT INTO "Beta" ("id", "favorite.id")
        VALUES (${beta}, ${targetB})
      `
      await database.sql`
        INSERT INTO "Pet" ("id", "owner.id")
        VALUES (${petA1}, ${targetA}), (${petA2}, ${targetA}), (${petB}, ${targetB})
      `

      const counts = await queryEntity<{
        favorite: { 'pets.$count': number },
        id: string,
      }>(database.sql, variantDefinitions, 'Source', {
        fields: ['id', 'favorite.pets.$count'],
        orderBy: 'id',
      })
      expect(counts.map(row => row.favorite['pets.$count'])).toEqual([2, 1])
      expect(await queryEntity<{ id: string }>(database.sql, variantDefinitions, 'Source', {
        fields: ['id'],
        orderBy: 'id',
        where: 'favorite.pets.$count >= 2',
      })).toEqual([{ id: alpha }])
      expect(await queryEntity<{ id: string }>(database.sql, variantDefinitions, 'Source', {
        fields: ['id'],
        orderBy: 'id',
        where: 'favorite.pets.$count >= 1',
      })).toEqual([{ id: alpha }, { id: beta }])
      expect(await queryEntity<{ id: string }>(database.sql, variantDefinitions, 'Source', {
        fields: ['id'],
        orderBy: 'id',
        where: 'favorite.pets.$count = 1',
      })).toEqual([{ id: beta }])
      const structuredCount = compileEntityQuery(variantDefinitions, 'Source', {
        fields: ['id'],
        orderBy: 'id',
        where: {
          field: 'favorite.pets.$count',
          operator: Operator.Comparison.Equal,
          value: 1,
        },
      })
      const stringCount = compileEntityQuery(variantDefinitions, 'Source', {
        fields: ['id'],
        orderBy: 'id',
        where: 'favorite.pets.$count = 1',
      })
      expect(stringCount.sql).toBe(structuredCount.sql)
      expect(stringCount.values).toEqual(structuredCount.values)

      const previews = await queryEntity<{
        favorite: { pets: { items: unknown[], total: number } },
        id: string,
      }>(database.sql, variantDefinitions, 'Source', {
        collections: { 'favorite.pets': { limit: 1 } },
        fields: ['id', 'favorite.pets'],
        orderBy: 'id',
      })
      expect(previews.map(row => row.favorite.pets.total)).toEqual([2, 1])
      expect(previews.map(row => row.favorite.pets.items.length)).toEqual([1, 1])
    })
  }, 120_000)
})
