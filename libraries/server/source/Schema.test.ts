import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { DDL, orderMigrationOperations } from './Schema'

describe('migration operation ordering', () => {
  test('fails deterministically when operations have an unresolved cycle', () => {
    expect(() => orderMigrationOperations([
      { dependsOn: ['b'], id: 'a', kind: 'table', risk: 'safe', sql: '', target: 'a' },
      { dependsOn: ['a'], id: 'b', kind: 'table', risk: 'safe', sql: '', target: 'b' },
    ])).toThrow('unresolved operation dependencies')
  })
})

describe('schema column naming', () => {
  test('quotes dotted reference columns as one identifier', () => {
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
    expect(plan.operations.find(operation => operation.id === 'column:Note:owner.id')?.sql)
      .toBe('ALTER TABLE "Note" ADD COLUMN "owner.id" text')
  })
})
