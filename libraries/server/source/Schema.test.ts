import { describe, expect, test } from 'bun:test'
import { orderMigrationOperations } from './Schema'

describe('migration operation ordering', () => {
  test('fails deterministically when operations have an unresolved cycle', () => {
    expect(() => orderMigrationOperations([
      { dependsOn: ['b'], id: 'a', kind: 'table', risk: 'safe', sql: '', target: 'a' },
      { dependsOn: ['a'], id: 'b', kind: 'table', risk: 'safe', sql: '', target: 'b' },
    ])).toThrow('unresolved operation dependencies')
  })
})
