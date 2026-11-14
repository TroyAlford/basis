import { describe, expect, test } from 'bun:test'
import { withDurableDatabase, withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { installSchema } from '../testing/Schema'
import { transactionWithMutations } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { MutationError } from './Mutation'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [{ field: 'email', type: 'String', unique: true }],
      name: 'Person',
    },
    {
      extends: 'Person',
      fields: [],
      name: 'User',
    },
    {
      extends: 'Person',
      fields: [{ field: 'department', type: 'String' }],
      name: 'Employee',
    },
    {
      fields: [
        { field: 'title', maxLength: 20, type: 'String' },
        { default: 0, field: 'score', maximum: 10, minimum: 0, type: 'Number' },
        { field: 'owner', nullable: false, target: 'Person', type: 'Entity' },
        { field: 'tags', items: { type: 'String' }, nullable: true, type: 'Array' },
        { field: 'payload', nullable: true, type: 'JSON' },
      ],
      name: 'Article',
    },
    {
      fields: [
        { field: 'article', nullable: false, target: 'Article', type: 'Entity' },
        { field: 'body', type: 'String' },
      ],
      name: 'Comment',
    },
  ],
}))

/**
 * Capture one mutation failure.
 * @param work - Work expected to fail.
 * @returns The captured mutation error.
 */
async function mutationFailure(work: () => Promise<unknown>): Promise<MutationError> {
  try {
    await work()
  } catch (error) {
    if (error instanceof MutationError) return error
    throw error
  }
  throw new Error('Expected mutation to fail')
}

describe('Graph mutations', () => {
  test('creates one object, finite batches, MTI chains, arrays, and JSON', async () => {
    await withIsolatedDatabase('mutation-create', async database => {
      await database.use(definitions)
      const user = await database.create('User', {
        email: 'ada@example.com',
        name: 'Ada',
      })
      expect(user).toEqual({ created: 1 })
      const employee = await database.create('Employee', {
        department: 'Engineering',
        email: 'grace@example.com',
        name: 'Grace',
      })
      expect(employee).toEqual({ created: 1 })
      const users = await database.query('Person', {
        fields: ['email', 'name'],
        orderBy: 'email',
      })
      expect(users).toEqual([
        { email: 'ada@example.com', name: 'Ada' },
        { email: 'grace@example.com', name: 'Grace' },
      ])

      const [ada] = await database.query<{ id: string }>('User', {
        fields: ['id'],
        where: 'email == \'ada@example.com\'',
      })
      if (!ada) throw new Error('Ada was not created')
      expect(await database.create('Article', [
        {
          name: 'First',
          owner: ada.id,
          payload: { kind: 'note' },
          score: 5,
          tags: ['one', 'two'],
          title: 'First',
        },
        {
          name: 'Second',
          owner: ada.id,
          title: 'Second',
        },
      ])).toEqual({ created: 2 })
      const articles = await database.query<{
        payload: unknown,
        score: number,
        tags: string[] | null,
        title: string,
      }>('Article', {
        fields: ['title', 'score', 'tags', 'payload'],
        orderBy: 'title',
      })
      expect(articles).toEqual([
        { payload: { kind: 'note' }, score: 5, tags: ['one', 'two'], title: 'First' },
        { payload: null, score: 0, tags: null, title: 'Second' },
      ])
    })
  }, 120_000)

  test('validates payloads and rolls an entire batch back on a database constraint', async () => {
    await withIsolatedDatabase('mutation-create-rollback', async database => {
      await database.use(definitions)
      await database.create('User', { email: 'ada@example.com', name: 'Ada' })
      const [ada] = await database.query<{ id: string }>('User', { fields: ['id'] })
      if (!ada) throw new Error('Ada was not created')
      const invalid = await mutationFailure(() => database.create('Article', [
        { name: 'One', owner: ada.id, title: 'One' },
        { name: 'Two', owner: ada.id, title: 'x'.repeat(21) },
      ]))
      expect(invalid.code).toBe('validation')
      expect(invalid.path).toBe('/values/1/title')
      expect(await database.query('Article', { fields: ['id'] })).toEqual([])

      const id = '00000000-0000-4000-8000-000000000001'
      expect(await database.create('Article', {
        id,
        name: 'Duplicate',
        owner: ada.id,
        title: 'Duplicate',
      })).toEqual({ created: 1 })
      const duplicate = await database.captureError(() => database.create('Article', [
        { name: 'Third', owner: ada.id, title: 'Third' },
        { id, name: 'Fourth', owner: ada.id, title: 'Fourth' },
      ]))
      expect(duplicate).toBeInstanceOf(MutationError)
      expect((duplicate as MutationError).code).toBe('constraint')
      expect(await database.query('Article', { fields: ['title'], orderBy: 'title' }))
        .toEqual([{ title: 'Duplicate' }])
    })
  }, 120_000)

  test('edits zero-to-many frozen sets with string and structured filters', async () => {
    await withIsolatedDatabase('mutation-edit', async database => {
      await database.use(definitions)
      await database.create('User', { email: 'ada@example.com', name: 'Ada' })
      const [ada] = await database.query<{ id: string }>('User', { fields: ['id'] })
      if (!ada) throw new Error('Ada was not created')
      await database.create('Article', [
        { name: 'A', owner: ada.id, score: 5, title: 'Old' },
        { name: 'B', owner: ada.id, score: 6, title: 'Old' },
        { name: 'C', owner: ada.id, score: 1, title: 'Keep' },
      ])

      expect(await database.edit('Article', 'score >= 5', { score: 0 }))
        .toEqual({ edited: 2 })
      expect(await database.edit('Article', 'title == \'Old\'', { title: 'New' }))
        .toEqual({ edited: 2 })
      expect(await database.edit('Article', 'title == \'Missing\'', { title: 'Never' }))
        .toEqual({ edited: 0 })
      expect(await database.edit('Article', {
        field: 'score',
        operator: '$gte',
        value: 5,
      }, { score: 10 })).toEqual({ edited: 0 })
      const articles = await database.query<{ score: number, title: string }>('Article', {
        fields: ['title', 'score'],
        orderBy: 'title',
      })
      expect(articles).toEqual([
        { score: 1, title: 'Keep' },
        { score: 0, title: 'New' },
        { score: 0, title: 'New' },
      ])
      const nulls = await mutationFailure(() => database.edit('Article', 'title == \'Keep\'', {
        title: null,
      }))
      expect(nulls.path).toBe('/changes/title')
      expect(await database.edit('Article', 'title == \'Keep\'', { payload: null }))
        .toEqual({ edited: 1 })
    })
  }, 120_000)

  test('deletes filtered sets and preserves references and inheritance integrity', async () => {
    await withIsolatedDatabase('mutation-delete', async database => {
      await database.use(definitions)
      await database.create('User', { email: 'ada@example.com', name: 'Ada' })
      const [ada] = await database.query<{ id: string }>('User', { fields: ['id'] })
      if (!ada) throw new Error('Ada was not created')
      await database.create('Article', { name: 'A', owner: ada.id, title: 'A' })
      const [article] = await database.query<{ id: string }>('Article', { fields: ['id'] })
      if (!article) throw new Error('Article was not created')
      await database.create('Comment', {
        article: article.id,
        body: 'First',
        name: 'Comment',
      })

      const blocked = await database.captureError(() => database.delete('Article', 'title == \'A\''))
      expect(blocked).toBeInstanceOf(MutationError)
      expect((blocked as MutationError).code).toBe('constraint')
      expect(await database.query('Article', { fields: ['title'] })).toEqual([{ title: 'A' }])
      expect(await database.delete('Comment', 'body == \'First\'')).toEqual({ deleted: 1 })
      expect(await database.delete('Article', 'title == \'A\'')).toEqual({ deleted: 1 })
      expect(await database.delete('Article', 'title == \'A\'')).toEqual({ deleted: 0 })
    })
  }, 120_000)

  test('upserts with zero, one, and ambiguous authorized matches', async () => {
    await withIsolatedDatabase('mutation-upsert', async database => {
      await database.use(definitions)
      await database.create('User', { email: 'ada@example.com', name: 'Ada' })
      const [ada] = await database.query<{ id: string }>('User', { fields: ['id'] })
      if (!ada) throw new Error('Ada was not created')
      expect(await database.upsert('Article', 'title == \'One\'', {
        name: 'One',
        owner: ada.id,
        score: 3,
        title: 'One',
      })).toEqual({ created: 1, edited: 0 })
      expect(await database.upsert('Article', 'title == \'One\'', {
        name: 'One',
        score: 9,
        title: 'One',
      })).toEqual({ created: 0, edited: 1 })
      await database.create('Article', { name: 'Two', owner: ada.id, title: 'Two' })
      const ambiguous = await mutationFailure(() => database.upsert(
        'Article',
        `owner == '${ada.id}'`,
        { name: 'Ambiguous', owner: ada.id, title: 'Ambiguous' },
      ))
      expect(ambiguous.code).toBe('cardinality')
      const articles = await database.query<{ score: number, title: string }>('Article', {
        fields: ['title', 'score'],
        orderBy: 'title',
      })
      expect(articles).toEqual([
        { score: 9, title: 'One' },
        { score: 0, title: 'Two' },
      ])
    })
  }, 120_000)

  test('serializes concurrent upserts for the same filter', async () => {
    await withDurableDatabase('mutation-upsert-concurrency', async database => {
      await database.tx(async sql => installSchema(sql, definitions))
      await database.tx(async sql => transactionWithMutations(definitions, sql).create(
        'User',
        { email: 'concurrent@example.com', name: 'Concurrent' },
      ))
      const [user] = await database.tx(async sql => sql<{ id: string }[]>`
        SELECT "id"
        FROM "Person"
        WHERE "email" = 'concurrent@example.com'
      `)
      if (!user) throw new Error('Concurrent user was not created')
      const results = await Promise.all(Array.from({ length: 6 }, () => (
        database.tx(async sql => transactionWithMutations(definitions, sql).upsert(
          'Article',
          'title == \'Concurrent\'',
          {
            name: 'Concurrent',
            owner: user.id,
            score: 5,
            title: 'Concurrent',
          },
        ))
      )))
      expect(results.filter(result => result.created === 1)).toHaveLength(1)
      expect(results.filter(result => result.edited === 1)).toHaveLength(5)
      const [count] = await database.tx(async sql => sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "Article"
        WHERE "title" = 'Concurrent'
      `)
      expect(count?.count).toBe(1)
    })
  }, 120_000)

  test('shares one native transaction between SQL and mutation verbs', async () => {
    await withDurableDatabase('mutation-transaction', async database => {
      await database.tx(async sql => installSchema(sql, definitions))
      await database.tx(async sql => {
        const mutations = transactionWithMutations(definitions, sql)
        await mutations.create('User', { email: 'commit@example.com', name: 'Commit' })
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES ('00000000-0000-4000-8000-000000000001', 'SQL', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id", "score")
          VALUES ('00000000-0000-4000-8000-000000000001',
            'SQL',
            (SELECT "id" FROM "Person" WHERE "email" = 'commit@example.com' ),
            0)
        `
      })
      const committed = await database.tx(async sql => sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "Article"
      `)
      expect(committed[0]?.count).toBe(1)

      await expect(database.tx(async sql => {
        const mutations = transactionWithMutations(definitions, sql)
        await mutations.create('User', { email: 'rollback@example.com', name: 'Rollback' })
        await sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES ('00000000-0000-4000-8000-000000000002', 'Rollback', 'Article')
        `
        await sql`
          INSERT INTO "Article" ("id", "title", "owner.id", "score")
          VALUES ('00000000-0000-4000-8000-000000000002',
            'Rollback',
            (SELECT "id" FROM "Person" WHERE "email" = 'rollback@example.com' ),
            0)
        `
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      const rolledBack = await database.tx(async sql => sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "Person"
        WHERE "email" = 'rollback@example.com'
      `)
      expect(rolledBack[0]?.count).toBe(0)
    })
  }, 120_000)
})
