import { describe, expect, test } from 'bun:test'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { EntityDefinitions } from './EntityDefinitions'
import { Graph } from './Graph'
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
    const positions = new Map(plan.operations.map((operation, index) => [operation.id, index]))
    expect(plan.operations.every(operation => (
      operation.dependsOn.every(dependency => ids.has(dependency)
        && (positions.get(dependency) ?? Infinity) < (positions.get(operation.id) ?? -1))
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
    const previous = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', role: 'public', target: 'Note' }],
    })
    const desired = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Note' },
        { fields: [{ field: 'title', type: 'String' }], name: 'Tag' },
      ],
      grants: [
        { action: 'read', role: 'public', target: 'Note' },
        { action: 'read', role: 'public', target: 'Tag' },
      ],
    })
    await withIsolatedDatabase('schema-plan-new-auth-table', async database => {
      await previous.definitions.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, appRole: 'basis_app', desired, previous, superuser: true })
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

  test('plans an intended entity removal without redundant child drops', async () => {
    const previous = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Note' },
        { fields: [{ field: 'title', type: 'String' }], name: 'Tag' },
      ],
    }))
    const desired = definitions('Note')
    await withIsolatedDatabase('schema-plan-remove', async database => {
      await previous.createTables(database.sql)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired, includeAuthorization: false, previous })
      expect(plan.operations.some(operation => operation.id === 'drop-table:Tag' || (
        operation.kind === 'table' && operation.target === 'Tag' && operation.sql.startsWith('DROP')
      ))).toBe(true)
      expect(plan.operations.some(operation => operation.target === 'Tag_leaf_check')).toBe(false)
      expect(plan.blocked).toBe(false)
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
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', role: 'public', target: 'Note' }],
    })
    await withIsolatedDatabase('schema-plan-rls', async database => {
      await model.definitions.createTables(database.sql)
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

  test('compiles stable typed identities for authorization privileges', () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', role: 'public', target: 'Note' }],
    })
    const grants = model.physicalSchema('basis_app', false, true).grants ?? []
    expect(grants.some(grant => grant.name === 'grant:basis_app:table:Note:SELECT')).toBe(true)
    expect(grants.some(grant => grant.name === 'grant:basis_app:schema:basis:USAGE')).toBe(true)
    expect(grants.some(grant => grant.name === 'grant:basis_app:function:basis.has_role:EXECUTE')).toBe(true)
    expect(grants.some(grant => (
      grant.kind === 'revoke' && grant.grantName?.includes('function:basis.has_role')
    ))).toBe(true)
  })

  test('plans graph role metadata changes while preserving role identity', () => {
    const previous = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      roles: { editor: { name: 'Editor' } },
    })
    const desired = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      roles: { editor: { name: 'Editor Renamed' } },
    })
    const role = previous.role('editor')
    if (!role) throw new Error('editor role was not loaded')
    const plan = DDL.plan({
      actual: previous.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired,
      previous,
    })
    expect(plan.drift).toEqual([])
    expect(plan.blocked).toBe(false)
    expect(plan.operations.some(operation => (
      operation.kind === 'role' && operation.id === `role:${role.id}:replace`
    ))).toBe(true)
  })

  test('plans a reviewed policy replacement instead of drift', () => {
    const previous = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', predicate: "title = 'x'", role: 'public', target: 'Note' }],
    })
    const desired = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', predicate: "title = 'y'", role: 'public', target: 'Note' }],
    })
    const plan = DDL.plan({
      actual: previous.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired,
      previous,
    })
    expect(plan.drift).toEqual([])
    expect(plan.blocked).toBe(false)
    expect(plan.operations.some(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))).toBe(true)
  })

  test('plans PUBLIC EXECUTE revocations after newly created security functions', () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', predicate: "title = 'x'", role: 'public', target: 'Note' }],
    })
    const empty = {
      constraints: [],
      extensions: [],
      functions: [],
      policies: [],
      tables: [],
      triggers: [],
    }
    const plan = DDL.plan({ actual: empty, appRole: 'basis_app', desired: model })
    const revokes = plan.operations.filter(operation => (
      operation.kind === 'grant' && operation.sql.startsWith('REVOKE ALL ON FUNCTION')
    ))
    expect(revokes.some(operation => operation.sql.includes('basis.has_role'))).toBe(true)
    expect(revokes.some(operation => operation.sql.includes('basis.policy_'))).toBe(true)
    for (const revoke of revokes) {
      const functionTarget = revoke.dependsOn.find(dependency => dependency.startsWith('function:'))
      expect(functionTarget).toBeTruthy()
      expect(plan.operations.some(operation => operation.id === functionTarget)).toBe(true)
    }
    expect(plan.operations.some(operation => operation.sql.includes('basis.matches'))).toBe(false)
  })

  test('includes authorization objects in the desired physical output', async () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', role: 'public', target: 'Note' }],
    })
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
    expect(plan.operations.some(operation => operation.kind === 'extension')).toBe(true)
  })
})
