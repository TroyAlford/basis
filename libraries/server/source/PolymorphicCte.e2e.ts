import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DatabaseTestOptions } from '../testing/DatabaseFixture'
import { withDatabase } from '../testing/DatabaseFixture'
import { compileEntityQuery } from './Database'
import { Action, Graph, Security } from './Graph'

setDefaultTimeout(60_000)

const graph = new Graph({
  entities: [
    {
      fields: [{ field: 'rootField', type: 'String' }],
      name: 'RootRecord',
      security: { [Action.Read]: Security.Public },
    },
    {
      extends: 'RootRecord',
      fields: [{ field: 'middleField', type: 'String' }],
      name: 'MiddleRecord',
    },
    {
      extends: 'MiddleRecord',
      fields: [{ field: 'onlyB', type: 'String' }],
      name: 'BranchB',
    },
    { extends: 'MiddleRecord', fields: [], name: 'BranchC' },
    { extends: 'MiddleRecord', fields: [], name: 'BranchD' },
  ],
})

const ids = {
  b: randomUUID(),
  c: randomUUID(),
  d: randomUUID(),
}

const options: DatabaseTestOptions = {
  graph,
  setup: async database => {
    await database.create('BranchB', {
      id: ids.b,
      middleField: 'middle-b',
      name: 'Branch B',
      onlyB: 'only-b',
      rootField: 'root-b',
    })
    await database.create('BranchC', {
      id: ids.c,
      middleField: 'middle-c',
      name: 'Branch C',
      rootField: 'root-c',
    })
    await database.create('BranchD', {
      id: ids.d,
      middleField: 'middle-d',
      name: 'Branch D',
      rootField: 'root-d',
    })
  },
}

test('projects abstract leaf-only fields, NULLs, and inherited owners', async () => {
  await withDatabase('polymorphic-cte-types', null, async database => {
    const rows = await database.query<{
      id: string,
      middleField: string,
      onlyB: string | null,
      rootField: string,
    }>('RootRecord', {
      fields: ['id', 'rootField', 'middleField', 'onlyB'],
      orderBy: 'id',
    })
    expect(rows).toEqual([
      { id: ids.b, middleField: 'middle-b', onlyB: 'only-b', rootField: 'root-b' },
      { id: ids.c, middleField: 'middle-c', onlyB: null, rootField: 'root-c' },
      { id: ids.d, middleField: 'middle-d', onlyB: null, rootField: 'root-d' },
    ].sort((left, right) => left.id.localeCompare(right.id)))

    const compiled = compileEntityQuery(graph.definitions, 'RootRecord', {
      fields: ['id', 'rootField', 'middleField', 'onlyB'],
      orderBy: 'id',
    })
    expect(compiled.sql).toContain('"authorized_RootRecord" AS NOT MATERIALIZED')
    expect(compiled.sql).toContain('"authorized_BranchB" AS NOT MATERIALIZED')
    expect(compiled.sql).toContain('"authorized_BranchC" AS NOT MATERIALIZED')
    expect(compiled.sql).toContain('"authorized_BranchD" AS NOT MATERIALIZED')
    expect(compiled.sql).toContain('FROM "authorized_BranchB"')
    expect(compiled.sql).toContain('"owner_RootRecord"."rootField" AS "rootField"')
    expect(compiled.sql).toContain('"owner_MiddleRecord"."middleField" AS "middleField"')
    expect(compiled.sql).toContain('UNION ALL')
    expect(compiled.sql).toContain('LEFT JOIN "authorized_BranchB"')
    expect(compiled.sql).not.toContain('JOIN "BranchB" "t"')
  }, options)
})

test('rejects incompatible sibling physical declarations before SQL emission', () => {
  expect(() => new Graph({
    entities: [
      { fields: [], name: 'Base' },
      { extends: 'Base', fields: [{ field: 'value', type: 'Number' }], name: 'NumberLeaf' },
      { extends: 'Base', fields: [{ field: 'value', type: 'String' }], name: 'StringLeaf' },
    ],
  })).toThrow('incompatible field contract')
})
