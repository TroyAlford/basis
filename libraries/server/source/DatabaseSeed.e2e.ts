import { expect, test } from 'bun:test'
import { withSeedDatabase } from '../testing/DatabaseSeed'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'

/*
 * The 500,000-row dataset is baked into the one seeded PostgreSQL image used by
 * the ordinary database lane. This proof reserves a connection to that same
 * instance and selects the seeded schema; it never starts a second container.
 */

test('queries prebuilt polymorphic descendants with indexed names', async () => {
  const entities = EntityDefinitions.load(JSON.stringify({
    entities: [
      {
        fields: [
          { field: 'id', format: 'Snowflake' },
          { field: 'nickname', type: 'String' },
        ],
        name: 'Pet',
      },
      {
        extends: 'Pet',
        fields: [{ field: 'breed', type: 'String' }],
        name: 'Dog',
      },
      {
        extends: 'Pet',
        fields: [{ field: 'indoor', type: 'Boolean' }],
        name: 'Cat',
      },
    ],
  }))
  await withSeedDatabase(async ({ sql }) => {
    const options = {
      fields: ['id', 'name', 'entity', 'nickname'],
      limit: 10,
      orderBy: 'name',
      where: { field: 'name', operator: Operator.Comparison.Contains, value: 'pet-250000' },
    } as const
    const rows = await queryEntity<{
      entity: string,
      id: string,
      name: string,
      nickname: string,
    }>(sql, entities, 'Pet', options)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entity: 'Dog',
      id: '250000',
      name: 'pet-250000',
      nickname: 'pet-250000',
    })

    const pageOne = await queryEntity<{ name: string }>(sql, entities, 'Pet', {
      fields: ['name'],
      limit: 3,
      orderBy: 'name',
    })
    const pageTwo = await queryEntity<{ name: string }>(sql, entities, 'Pet', {
      fields: ['name'],
      limit: 3,
      offset: 3,
      orderBy: 'name',
    })
    expect(pageOne.map(row => row.name)).toEqual(['pet-000001', 'pet-000002', 'pet-000003'])
    expect(pageTwo.map(row => row.name)).toEqual(['pet-000004', 'pet-000005', 'pet-000006'])

    expect(await queryEntity<{ name: string }>(sql, entities, 'Pet', {
      fields: ['name'],
      limit: 1,
      orderBy: [],
    })).toEqual([{ name: 'pet-000001' }])

    const compiled = compileEntityQuery(entities, 'Pet', options)
    const plan = await sql.unsafe<Record<string, string>[]>(
      `EXPLAIN (FORMAT TEXT) ${compiled.sql}`,
      [...compiled.values],
    )
    expect(plan.map(row => Object.values(row).join('\n')).join('\n'))
      .toContain('Entity_name_trgm_idx')
  })
}, 300_000)
