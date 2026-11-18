import type { SQL as BunSQL } from 'bun'
import { compileEntityQuery } from '../server/source/Database'
import { EntityDefinitions } from '../server/source/EntityDefinitions'
import { mutationRunner } from '../server/source/Mutation'
import { compilePolymorphicQuery } from '../server/source/PolymorphicQuery'
import { DDL } from '../server/source/Schema'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'species', type: 'String' },
      ],
      name: 'Pet',
    },
    {
      fields: [{ field: 'title', type: 'String' }],
      name: 'Note',
    },
    {
      fields: [],
      name: 'User',
    },
  ],
}))

/** A fake SQL client that records producer output. */
class RecordingSql {
  readonly calls: { sql: string, values: readonly unknown[] }[] = []
  readonly rows: Record<string, unknown>[] = [
    { entity: 'Pet', id: '00000000-0000-4000-8000-000000000001', name: 'Toby', species: 'Frog' },
  ]

  /**
   * Record one statement.
   * @param sql - SQL text.
   * @param values - Bound values.
   * @returns Rows for reads and RETURNING writes.
   */
  async unsafe(sql: string, values: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
    this.calls.push({ sql, values })
    return /^\s*(?:SELECT|WITH)|RETURNING/iu.test(sql) ? this.rows : []
  }
}

/** SQL emitted by the actual production generators used by dynamic call sites. */
export interface RuntimeSqlCorpus {
  sites: string[],
  sql: string[],
}

/**
 * Execute the current production SQL generators with representative inputs.
 * @returns Captured SQL and the runtime call-site identities it covers.
 */
export async function captureRuntimeSql(): Promise<RuntimeSqlCorpus> {
  const pet = definitions.entity('Pet')
  if (!pet) throw new Error('Missing Pet definition')
  const recording = new RecordingSql()
  await mutationRunner(definitions, recording as unknown as BunSQL)
    .create('Pet', { name: 'Toby', species: 'Frog' })
  const mutationStatements = recording.calls.map(call => call.sql)
  const compiled = compilePolymorphicQuery(definitions, pet, {
    fields: ['id', 'name'],
    limit: 1,
    where: { name: 'Toby' },
  })
  const entityQuery = compileEntityQuery(definitions, 'Pet', {
    fields: ['id', 'name'],
    limit: 1,
    where: { name: 'Toby' },
  })
  const base = EntityDefinitions.load(JSON.stringify({
    entities: [
      { fields: [{ field: 'title', type: 'String' }], name: 'Note' },
      { fields: [], name: 'User' },
    ],
  }))
  const desired = EntityDefinitions.load(JSON.stringify({
    entities: [
      {
        fields: [
          { field: 'title', type: 'String' },
          { field: 'owner', target: 'User', type: 'Entity' },
        ],
        name: 'Note',
      },
      { fields: [], name: 'User' },
    ],
  }))
  const plan = DDL.plan({
    actual: base.physicalSchema(),
    desired,
    previous: base,
    previousPhysical: base.physicalSchema(),
  })
  return {
    sites: ['compiled.sql', 'statement.sql', 'operation.sql', 'operation.sql', 'prepared.query.sql'],
    sql: [
      ...mutationStatements,
      compiled.sql,
      entityQuery.sql,
      ...plan.operations.map(operation => operation.sql),
    ],
  }
}
