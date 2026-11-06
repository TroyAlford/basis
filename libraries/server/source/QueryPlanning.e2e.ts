import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { IsolatedDatabase } from '../testing/DatabaseIsolation'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'

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
  /** Summed shared hit blocks. */
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
  /** Summed temporary read/write blocks. */
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
 * Sum selected numeric metrics over a plan tree.
 * @param plan - PostgreSQL plan node.
 * @param keys - Metric keys to sum.
 * @returns Summed metric value and node count.
 */
function planMetrics(
  plan: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): { readonly nodes: number, readonly value: number } {
  const children = Array.isArray(plan.Plans) ? plan.Plans as readonly Readonly<Record<string, unknown>>[] : []
  let value = 0
  for (const key of keys) value += Number(plan[key] ?? 0)
  let nodes = 1
  for (const child of children) {
    const nested = planMetrics(child, keys)
    value += nested.value
    nodes += nested.nodes
  }
  return { nodes, value }
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
  const buffers = planMetrics(document.Plan, ['Shared Hit Blocks', 'Shared Read Blocks'])
  const temp = planMetrics(document.Plan, ['Temp Read Blocks', 'Temp Written Blocks'])
  return {
    buffers: buffers.value,
    execution: document['Execution Time'],
    name,
    nodes: buffers.nodes,
    planning: document['Planning Time'],
    rows: Number(document.Plan['Actual Rows'] ?? 0),
    sqlBytes: Buffer.byteLength(sql),
    temp: temp.value,
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

      const correlated = compileEntityQuery(definitions, 'Person', {
        fields: ['id'],
        limit: 25,
        orderBy: 'id',
        where: 'pets.$count >= 2',
      })
      const countCte = (modifier: string) => `
        WITH pet_counts AS ${modifier} (
          SELECT "owner.id" AS "owner_id", count(*)::int AS "total"
          FROM "Pet"
          GROUP BY "owner.id"
        )
        SELECT t."id" AS "id"
        FROM "Person" t
        LEFT JOIN pet_counts c ON c."owner_id" = t."id"
        WHERE COALESCE(c."total", 0) >= 2
        ORDER BY t."id" ASC
        LIMIT 25
      `
      const variants = [
        {
          name: 'correlated',
          sql: correlated.sql,
          values: correlated.values,
        },
        { name: 'cte-default', sql: countCte(''), values: [] },
        { name: 'cte-materialized', sql: countCte('MATERIALIZED'), values: [] },
        { name: 'cte-not-materialized', sql: countCte('NOT MATERIALIZED'), values: [] },
      ]

      const results = []
      const metrics: MeasuredPlan[] = []
      for (const variant of variants) {
        const rows = await database.sql.unsafe<{ id: string }[]>(variant.sql, [...variant.values])
        results.push(rows.map(row => row.id))
        metrics.push(await measure(database, variant.name, variant.sql, variant.values))
      }
      expect(results.every(ids => ids.join(',') === results[0]?.join(','))).toBe(true)
      expect(results[0]?.length).toBeGreaterThan(0)
      expect(metrics).toHaveLength(variants.length)
      for (const metric of metrics) {
        expect(metric.planning).toBeGreaterThanOrEqual(0)
        expect(metric.execution).toBeGreaterThanOrEqual(0)
        expect(metric.rows).toBeGreaterThan(0)
        expect(metric.buffers).toBeGreaterThanOrEqual(0)
        expect(metric.temp).toBeGreaterThanOrEqual(0)
        expect(metric.nodes).toBeGreaterThan(0)
        expect(metric.sqlBytes).toBeGreaterThan(0)
      }
      expect(metrics.map(metric => metric.name)).toEqual([
        'correlated',
        'cte-default',
        'cte-materialized',
        'cte-not-materialized',
      ])

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
})
