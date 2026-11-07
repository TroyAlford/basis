import { describe, expect, test } from 'bun:test'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { Authorization } from './Authorization'
import { EntityDefinitions } from './EntityDefinitions'
import { DDL } from './Schema'

/**
 * Load one small canonical model.
 * @param name - Entity name.
 * @returns Validated definitions.
 */
function definitions(name = 'Note'): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify({
    entities: [{
      fields: [{ field: 'title', type: 'String' }],
      name,
    }],
  }))
}

describe('DDL schema planning', () => {
  test('plans an empty catalog without mutating it', async () => {
    const desired = definitions()
    const empty = {
      constraints: [],
      extensions: [],
      functions: [],
      policies: [],
      tables: [],
      triggers: [],
    }
    const plan = DDL.plan({ actual: empty, desired, includeAuthorization: false })
    expect(plan.operations.some(operation => operation.kind === 'table')).toBe(true)
    expect(plan.operations.some(operation => operation.kind === 'constraint')).toBe(true)
    expect(plan.blocked).toBe(false)
    const ids = new Set(plan.operations.map(operation => operation.id))
    expect(plan.operations.every(operation => (
      operation.dependsOn.every(dependency => ids.has(dependency))
    ))).toBe(true)
  })

  test('reports no operations for an unchanged live model', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-plan-unchanged', async database => {
      await model.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired: model, includeAuthorization: false })
      expect(plan.drift).toEqual([])
      expect(plan.operations).toEqual([])
    }, { fresh: true })
  })

  test('plans additive tables without writing them', async () => {
    const previous = definitions('Note')
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Note' },
        { fields: [{ field: 'label', type: 'String' }], name: 'Tag' },
      ],
    }))
    await withIsolatedDatabase('schema-plan-additive', async database => {
      await previous.createTables(database.sql)
      const before = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual: before, desired, includeAuthorization: false, previous })
      expect(plan.operations.some(operation => operation.target === 'Tag')).toBe(true)
      const after = await DDL.introspect(database.sql)
      expect(after).toEqual(before)
    }, { fresh: true })
  })

  test('reports ambiguous table rename candidates instead of guessing', async () => {
    const previous = definitions('OldNote')
    const desired = definitions('NewNote')
    await withIsolatedDatabase('schema-plan-ambiguous', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired, includeAuthorization: false, previous })
      expect(plan.ambiguities).toContain('OldNote -> NewNote')
      expect(plan.blocked).toBe(true)
    }, { fresh: true })
  })

  test('plans a named relationship table additively', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [], name: 'Campaign' }, { fields: [], name: 'User' }],
    }))
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [], name: 'Campaign' }, { fields: [], name: 'User' }],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [],
        name: 'Membership',
      }],
    }))
    await withIsolatedDatabase('schema-plan-relationship', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired, includeAuthorization: false, previous })
      expect(plan.operations.some(operation => operation.target === 'Membership')).toBe(true)
      expect(plan.drift).toEqual([])
    }, { fresh: true })
  })

  test('plans an MTI descendant without rewriting the ancestor', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'email', type: 'String' }], name: 'Profile' }],
    }))
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
        { extends: 'Profile', fields: [], name: 'Employee' },
      ],
    }))
    await withIsolatedDatabase('schema-plan-mti', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired, includeAuthorization: false, previous })
      expect(plan.operations.some(operation => operation.target === 'Employee')).toBe(true)
      expect(plan.operations.some(operation => operation.id === 'drop-trigger:Profile_leaf_check')).toBe(true)
      expect(plan.blocked).toBe(false)
    }, { fresh: true })
  })

  test('plans a legitimate column type change as a reviewable operation', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'amount', type: 'String' }], name: 'Note' }],
    }))
    const desired = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'amount', type: 'Number' }], name: 'Note' }],
    }))
    await withIsolatedDatabase('schema-plan-column-change', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired, includeAuthorization: false, previous })
      expect(plan.operations.some(operation => operation.kind === 'alter-column')).toBe(true)
      expect(plan.blocked).toBe(false)
    }, { fresh: true })
  })

  test('includes RLS and grants for a newly authorized table', async () => {
    const previous = Authorization.load(JSON.stringify({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
    }))
    const desired = Authorization.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Note' },
        { fields: [{ field: 'title', type: 'String' }], name: 'Tag' },
      ],
    }))
    await withIsolatedDatabase('schema-plan-new-auth-table', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, appRole: 'basis_app', desired, superuser: true })
      expect(plan.operations.some(operation => (
        operation.kind === 'row-security' && operation.target === 'Tag'
      ))).toBe(true)
      expect(plan.operations.some(operation => (
        operation.kind === 'grant' && operation.sql.includes('"Tag"')
      ))).toBe(true)
    }, { fresh: true })
  })

  test('treats a missing previously deployed table as drift, not an addition', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-plan-missing-deployed', async database => {
      await model.createTables(database.sql)
      await database.sql`
        DROP TABLE "Note"
      `
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired: model, includeAuthorization: false, previous: model })
      expect(plan.drift).toContain('missing deployed table: Note')
      expect(plan.operations.some(operation => operation.id === 'table:Note')).toBe(false)
      expect(plan.blocked).toBe(true)
    }, { fresh: true })
  })

  test('reports live catalog drift as a blocker', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-plan-drift', async database => {
      await model.createTables(database.sql)
      await database.sql`
        CREATE TABLE "Unexpected" ("id" text PRIMARY KEY)
      `
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired: model, includeAuthorization: false, previous: model })
      expect(plan.drift).toContain('unexpected table: Unexpected')
      expect(plan.blocked).toBe(true)
    }, { fresh: true })
  })

  test('plans missing RLS and authorization enforcement for an existing model', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-plan-rls', async database => {
      await model.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        appRole: 'basis_app',
        desired: model,
        superuser: true,
      })
      expect(plan.operations.some(operation => operation.kind === 'row-security')).toBe(true)
      expect(plan.operations.some(operation => operation.kind === 'policy')).toBe(true)
      expect(plan.drift).toEqual([])
      const ids = new Set(plan.operations.map(operation => operation.id))
      expect(plan.operations.every(operation => (
        operation.dependsOn.every(dependency => ids.has(dependency))
      ))).toBe(true)
    }, { fresh: true })
  })

  test('includes authorization objects in the desired physical output', async () => {
    const model = definitions()
    const empty = {
      constraints: [],
      extensions: [],
      functions: [],
      policies: [],
      tables: [],
      triggers: [],
    }
    const plan = DDL.plan({ actual: empty, appRole: 'basis_app', desired: model })
    expect(plan.operations.some(operation => operation.kind === 'policy')).toBe(true)
    expect(plan.operations.some(operation => operation.kind === 'function')).toBe(true)
    expect(plan.operations.some(operation => operation.kind === 'grant')).toBe(true)
    expect(plan.operations.some(operation => (
      operation.kind === 'extension' && operation.target === 'pgcrypto'
    ))).toBe(true)
  })
})
