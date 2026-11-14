import type { SQL as BunSQL } from 'bun'
import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { MutationError, mutationRunner } from './Mutation'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'age', maximum: 20, minimum: 0, nullable: true, type: 'Number' },
        { field: 'species', type: 'String' },
        { field: 'nickname', nullable: true, type: 'String' },
      ],
      name: 'Pet',
    },
    {
      fields: [{ field: 'email', type: 'String' }],
      name: 'User',
    },
    {
      extends: 'User',
      fields: [{ field: 'department', type: 'String' }],
      name: 'Member',
    },
    {
      fields: [{ field: 'status', type: 'String' }],
      name: 'Job',
    },
  ],
}))

/** One recorded SQL call. */
interface SQLCall {
  /** SQL text. */
  readonly sql: string,
  /** Bound values. */
  readonly values: readonly unknown[],
}

/** A fake transaction client that records statements. */
class FakeSQL {
  /** Recorded calls. */
  readonly calls: SQLCall[] = []
  /** Rows returned by SELECT statements. */
  rows: Record<string, unknown>[] = []

  /**
   * Record and answer one statement.
   * @param sql - SQL text.
   * @param values - Bound values.
   * @returns The configured rows for SELECT, otherwise an empty array.
   */
  async unsafe(sql: string, values: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
    this.calls.push({ sql, values })
    if (sql.includes('pg_advisory_xact_lock')) return []
    if (sql.trimStart().startsWith('SELECT')) return this.rows
    if (sql.includes('RETURNING "id"')) return this.rows
    return []
  }
}

/**
 * Build the mutation capability over a fake client.
 * @param sql - Fake client.
 * @returns The mutation vocabulary.
 */
function runner(sql: FakeSQL) {
  return mutationRunner(definitions, sql as unknown as BunSQL)
}

/**
 * Capture one mutation failure.
 * @param work - Work expected to fail.
 * @returns The captured error.
 */
async function failure(work: () => Promise<unknown>): Promise<MutationError> {
  try {
    await work()
  } catch (error) {
    if (error instanceof MutationError) return error
    throw error
  }
  throw new Error('Expected mutation to fail')
}

describe('Mutation', () => {
  test('validates canonical create values before any write', async () => {
    const sql = new FakeSQL()
    const mutations = runner(sql)
    expect(await mutations.create('Pet', { name: 'Toby', species: 'Frog' }))
      .toEqual({ created: 1 })
    expect(sql.calls.map(call => call.sql)).toEqual([
      'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
      'INSERT INTO "Pet" ("id", "species") VALUES ($1, $2)',
    ])
    expect(sql.calls[0]?.values[1]).toBe('Toby')
    expect(sql.calls[0]?.values[2]).toBe('Pet')
  })

  test('inserts the complete MTI chain with owned fields only', async () => {
    const sql = new FakeSQL()
    const mutations = runner(sql)
    expect(await mutations.create('Member', {
      department: 'Engineering',
      email: 'ada@example.com',
      name: 'Ada',
    })).toEqual({ created: 1 })
    expect(sql.calls.map(call => call.sql)).toEqual([
      'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
      'INSERT INTO "User" ("id", "email") VALUES ($1, $2)',
      'INSERT INTO "Member" ("id", "department") VALUES ($1, $2)',
    ])
  })

  test('reports payload-rooted validation paths for one and many values', async () => {
    const mutations = runner(new FakeSQL())
    const missing = await failure(() => mutations.create('Pet', { species: 'Frog' }))
    expect(missing.code).toBe('validation')
    expect(missing.path).toBe('/values/0/name')
    const batch = await failure(() => mutations.create('Pet', [
      { name: 'Toby', species: 'Frog' },
      { name: 7, species: 'Raccoon' },
    ]))
    expect(batch.path).toBe('/values/1/name')
    const unknown = await failure(() => mutations.create('Pet', {
      name: 'Toby',
      species: 'Frog',
      unknown: true,
    }))
    expect(unknown.path).toBe('/values/0/unknown')
    const readonly = await failure(() => mutations.create('Pet', {
      entity: 'User',
      name: 'Toby',
      species: 'Frog',
    }))
    expect(readonly.path).toBe('/values/0/entity')
    const nullable = await failure(() => mutations.create('Pet', {
      name: 'Toby',
      nickname: null,
      species: null,
    }))
    expect(nullable.path).toBe('/values/0/species')
    const bounds = await failure(() => mutations.create('Pet', {
      age: 21,
      name: 'Toby',
      species: 'Frog',
    }))
    expect(bounds.path).toBe('/values/0/age')
  })

  test('materializes finite iterables once and rejects implicit Map pairs', async () => {
    const sql = new FakeSQL()
    const mutations = runner(sql)
    let consumed = 0
    /**
     * Yield one valid and one invalid create value.
     * @yields {Readonly<Record<string, unknown>>} One create value.
     */
    function* values() {
      consumed += 1
      yield { name: 'Toby', species: 'Frog' }
      consumed += 1
      yield { name: 7, species: 'Raccoon' }
    }
    const error = await failure(() => mutations.create('Pet', values()))
    expect(error.path).toBe('/values/1/name')
    expect(consumed).toBe(2)
    expect(sql.calls).toHaveLength(0)
    const map = new Map([['toby', { name: 'Toby', species: 'Frog' }]])
    await expect(mutations.create(
      'Pet',
      map as unknown as Iterable<Readonly<Record<string, unknown>>>,
    )).rejects.toThrow('pass map.values()')
    expect(await mutations.create('Pet', map.values())).toEqual({ created: 1 })
  })

  test('rejects abstract targets and unknown entities with operation errors', async () => {
    const mutations = runner(new FakeSQL())
    const unknown = await failure(() => mutations.create('Ghost', { name: 'Boo' }))
    expect(unknown.code).toBe('operation')
    expect(unknown.message).toContain('Unknown entity')
  })

  test('rejects readonly edit fields and reports the changes pointer', async () => {
    const mutations = runner(new FakeSQL())
    const readonly = await failure(() => mutations.edit('Pet', 'id == 1', { id: '1' }))
    expect(readonly.code).toBe('validation')
    expect(readonly.path).toBe('/changes/id')
    const unknown = await failure(() => mutations.edit('Pet', 'id == 1', { missing: true }))
    expect(unknown.path).toBe('/changes/missing')
  })

  test('uses the canonical filter compiler for mutation filters', async () => {
    const mutations = runner(new FakeSQL())
    const error = await failure(() => mutations.edit('Pet', 'missing == 1', { name: 'Toby' }))
    expect(error.code).toBe('filter')
    expect(error.message).toContain('missing')
  })

  test('rejects ambiguous upserts before changing values', async () => {
    const sql = new FakeSQL()
    sql.rows = [
      { entity: 'Pet', id: '00000000-0000-4000-8000-000000000001' },
      { entity: 'Pet', id: '00000000-0000-4000-8000-000000000002' },
    ]
    const mutations = runner(sql)
    const error = await failure(() => mutations.upsert(
      'Pet',
      'name == \'Toby\'',
      { name: 'Toby', species: 'Frog' },
    ))
    expect(error.code).toBe('cardinality')
    expect(sql.calls.some(call => call.sql.startsWith('INSERT'))).toBe(false)
  })
})
