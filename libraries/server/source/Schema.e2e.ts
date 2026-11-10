import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { installSchema } from '../testing/Schema'
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
      await installSchema(database.sql, model)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, previous.definitions)
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
      await installSchema(database.sql, model)
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
      await installSchema(database.sql, previous)
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
      await installSchema(database.sql, model)
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
      await installSchema(database.sql, model.definitions)
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

  test('does not equate policy literals or Boolean precedence', () => {
    const entities = [{
      fields: [
        { field: 'title', type: 'String' },
        { field: 'active', type: 'Boolean' },
      ],
      name: 'Note',
    }] as const
    const literal = new Graph({
      entities,
      grants: [{ action: 'read', predicate: "title = 'a b'", role: 'public', target: 'Note' }],
    })
    const literalChanged = new Graph({
      entities,
      grants: [{ action: 'read', predicate: "title = 'ab'", role: 'public', target: 'Note' }],
    })
    const literalPlan = DDL.plan({
      actual: literal.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired: literalChanged,
      previous: literal,
    })
    expect(literalPlan.operations.some(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))).toBe(true)

    const left = new Graph({
      entities,
      grants: [{
        action: 'read',
        predicate: {
          filters: [
            { field: 'title', operator: '$eq', value: 'x' },
            {
              filters: [
                { field: 'active', operator: '$eq', value: true },
                { field: 'title', operator: '$eq', value: 'y' },
              ],
              operator: '$or',
            },
          ],
          operator: '$and',
        },
        role: 'public',
        target: 'Note',
      }],
    })
    const right = new Graph({
      entities,
      grants: [{
        action: 'read',
        predicate: {
          filters: [
            {
              filters: [
                { field: 'title', operator: '$eq', value: 'x' },
                { field: 'active', operator: '$eq', value: true },
              ],
              operator: '$and',
            },
            { field: 'title', operator: '$eq', value: 'y' },
          ],
          operator: '$or',
        },
        role: 'public',
        target: 'Note',
      }],
    })
    const precedencePlan = DDL.plan({
      actual: left.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired: right,
      previous: left,
    })
    expect(precedencePlan.operations.some(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))).toBe(true)
  })

  test('blocks an existing policy deployment without historical provenance', () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', predicate: "title = 'x'", role: 'public', target: 'Note' }],
    })
    const actual = model.physicalSchema('basis_app', false)
    const plan = DDL.plan({
      actual,
      appRole: 'basis_app',
      desired: model,
    })
    expect(plan.drift).toContain(
      'historical compiled physical artifact required for existing deployment planning',
    )
    expect(plan.blocked).toBe(true)
  })

  test('plans a generator-output change and blocks unexpected live policy drift', () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      grants: [{ action: 'read', predicate: "title = 'x'", role: 'public', target: 'Note' }],
    })
    const historical = model.physicalSchema('basis_app', false)
    const policy = historical.policies.find(candidate => candidate.name === 'basis_Note_read')
    if (!policy) throw new Error('compiled policy was not found')
    const previousPhysical = {
      ...historical,
      policies: historical.policies.map(candidate => (
        candidate.name === policy.name
          ? { ...candidate, definition: `${candidate.definition} ` }
          : candidate
      )),
    }
    const generatedPlan = DDL.plan({
      actual: previousPhysical,
      appRole: 'basis_app',
      desired: model,
      previousPhysical,
    })
    expect(generatedPlan.drift).toEqual([])
    expect(generatedPlan.operations.some(operation => (
      operation.kind === 'policy' && operation.id === `policy:${policy.name}:replace`
    ))).toBe(true)

    const sqlChanged = {
      ...historical,
      policies: historical.policies.map(candidate => (
        candidate.name === policy.name
          ? { ...candidate, sql: `${candidate.sql} ` }
          : candidate
      )),
    }
    const sqlPlan = DDL.plan({
      actual: sqlChanged,
      appRole: 'basis_app',
      desired: model,
      previousPhysical: sqlChanged,
    })
    expect(sqlPlan.drift).toEqual([])
    expect(sqlPlan.operations.some(operation => (
      operation.kind === 'policy' && operation.id === `policy:${policy.name}:replace`
    ))).toBe(true)

    const missingArtifact = DDL.plan({
      actual: historical,
      appRole: 'basis_app',
      desired: model,
      previous: model,
    })
    expect(missingArtifact.drift).toContain(
      'historical compiled physical artifact required for existing deployment planning',
    )
    expect(missingArtifact.blocked).toBe(true)

    const drifted = {
      ...historical,
      policies: historical.policies.map(candidate => (
        candidate.name === policy.name
          ? { ...candidate, roles: ['public'] }
          : candidate
      )),
    }
    const driftPlan = DDL.plan({
      actual: drifted,
      appRole: 'basis_app',
      desired: model,
      previousPhysical: historical,
    })
    expect(driftPlan.drift).toContain(`out-of-band policy definition change: ${policy.name}`)
    expect(driftPlan.blocked).toBe(true)
  })

  test('does not erase a Boolean clause after a JSON cast', () => {
    const entities = [{
      fields: [
        { field: 'details', type: 'JSON' },
        { field: 'active', type: 'Boolean' },
      ],
      name: 'Note',
    }] as const
    const predicate = (operator: '$and' | '$or') => ({
      filters: [
        { field: 'details', operator: '$contains', value: { type: 'safe' } },
        { field: 'active', operator: '$eq', value: true },
      ],
      operator,
    })
    const left = new Graph({
      entities,
      grants: [{ action: 'read', predicate: predicate('$and'), role: 'public', target: 'Note' }],
    })
    const right = new Graph({
      entities,
      grants: [{ action: 'read', predicate: predicate('$or'), role: 'public', target: 'Note' }],
    })
    const plan = DDL.plan({
      actual: left.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired: right,
      previous: left,
    })
    expect(plan.operations.some(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))).toBe(true)
  })

  test('plans real catalog policy and role changes', async () => {
    await withIsolatedDatabase('schema-plan-catalog-policy', async database => {
      const appRole = `basis_plan_app_${randomUUID().replaceAll('-', '').slice(0, 12)}`
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      const previous = new Graph({
        entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
        grants: [{ action: 'read', predicate: "title = 'x'", role: 'editor', target: 'Note' }],
        roles: { editor: { name: 'Editor' } },
        schema: database.schema,
      })
      const desired = new Graph({
        entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
        grants: [{ action: 'read', predicate: "title = 'y'", role: 'editor', target: 'Note' }],
        roles: { editor: { name: 'Editor Renamed' } },
        schema: database.schema,
      })
      await installSchema(database.sql, previous, {
        appRole,
        schema: database.schema,
        superuser: false,
      })
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        appRole,
        desired,
        previous,
        previousPhysical: previous.physicalSchema(appRole, false),
        superuser: false,
      })
      expect(plan.drift).toEqual([])
      expect(plan.blocked).toBe(false)
      expect(plan.operations.some(operation => operation.id.endsWith(':replace'))).toBe(true)
      expect(plan.operations.some(operation => operation.kind === 'role')).toBe(true)
    }, { fresh: true })
  })

  test('reports unexpected deployed graph roles as drift', () => {
    const model = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
      roles: { editor: { name: 'Editor' } },
    })
    const physical = model.physicalSchema('basis_app', false)
    const unexpected = randomUUID()
    const plan = DDL.plan({
      actual: {
        ...physical,
        roles: [...(physical.roles ?? []), { id: unexpected, name: 'Unexpected' }],
      },
      appRole: 'basis_app',
      desired: model,
      previous: model,
    })
    expect(plan.drift).toContain(`unexpected role: ${unexpected}`)
    expect(plan.blocked).toBe(true)
  })

  test('drops replaced predicate helpers with their canonical signature', () => {
    const entities = [
      { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
      { extends: 'Profile', fields: [], name: 'Employee' },
    ] as const
    const previous = new Graph({
      entities,
      grants: [{
        action: 'read',
        predicate: "email = 'x'",
        role: 'public',
        target: 'Employee',
      }],
    })
    const desired = new Graph({
      entities,
      grants: [{
        action: 'read',
        predicate: "email = 'y'",
        role: 'public',
        target: 'Employee',
      }],
    })
    const plan = DDL.plan({
      actual: previous.physicalSchema('basis_app', false),
      appRole: 'basis_app',
      desired,
      previous,
      previousPhysical: previous.physicalSchema('basis_app', false),
    })
    const drops = plan.operations.filter(operation => operation.id.startsWith('drop-function:basis.policy_'))
    expect(drops).toHaveLength(1)
    expect(drops[0]?.sql).toContain('(root_id text)')
    expect(drops[0]?.sql.endsWith('()')).toBe(false)
    const replacement = plan.operations.findIndex(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))
    const drop = plan.operations.findIndex(operation => operation.id === drops[0]?.id)
    expect(replacement).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(replacement)
  })

  test('executes the ordered policy/helper replacement sequence in PostgreSQL', async () => {
    await withIsolatedDatabase('schema-plan-catalog-helper', async database => {
      const appRole = `basis_plan_helper_${randomUUID().replaceAll('-', '').slice(0, 12)}`
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      const entities = [
        { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
        { extends: 'Profile', fields: [], name: 'Employee' },
      ] as const
      const previous = new Graph({
        entities,
        grants: [{
          action: 'read',
          predicate: "email = 'x'",
          role: 'public',
          target: 'Employee',
        }],
        schema: database.schema,
      })
      const desired = new Graph({
        entities,
        grants: [{
          action: 'read',
          predicate: "email = 'y'",
          role: 'public',
          target: 'Employee',
        }],
        schema: database.schema,
      })
      await installSchema(database.sql, previous, {
        appRole,
        schema: database.schema,
        superuser: false,
      })
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        appRole,
        desired,
        previous,
        superuser: false,
      })
      const oldHelpers = (previous.physicalSchema(appRole, false).functions ?? [])
        .filter(fn => fn.name.startsWith('basis.policy_'))
        .map(fn => fn.name)
      expect(oldHelpers).toHaveLength(1)
      const executable = plan.operations.filter(operation => (
        operation.kind === 'function' || operation.kind === 'policy'
      ))
      for (const operation of executable) {
        await database.sql.unsafe(operation.sql).simple()
      }
      const after = await DDL.introspect(database.sql)
      expect(after.functions.some(fn => oldHelpers.includes(fn.name))).toBe(false)
    }, { fresh: true })
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
      previousPhysical: previous.physicalSchema('basis_app', false),
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
      previousPhysical: previous.physicalSchema('basis_app', false),
    })
    expect(plan.drift).toEqual([])
    expect(plan.blocked).toBe(false)
    expect(plan.operations.some(operation => (
      operation.kind === 'policy' && operation.id.endsWith(':replace')
    ))).toBe(true)
  })

  test('plans PUBLIC EXECUTE revocations after newly created security functions', () => {
    const model = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
        { extends: 'Profile', fields: [], name: 'Employee' },
      ],
      grants: [{
        action: 'read',
        predicate: "email = 'x'",
        role: 'public',
        target: 'Employee',
      }],
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

  test('revokes public schema CREATE through the reviewed graph plan', async () => {
    const appRole = `basis_public_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    await withIsolatedDatabase('schema-public-create', async database => {
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      await database.sql.unsafe('GRANT CREATE ON SCHEMA public TO PUBLIC').simple()
      const model = new Graph({
        entities: [{ fields: [], name: 'Note' }],
        schema: database.schema,
      })
      await installSchema(database.sql, model, {
        appRole,
        schema: database.schema,
        superuser: true,
      })
      const [privilege] = await database.sql<{ create: boolean }[]>`
        SELECT has_schema_privilege(${appRole}, 'public', 'CREATE') AS "create"
      `
      expect(privilege?.create).toBe(false)
    }, { fresh: true })
  })

  test('detects a same-name index with the wrong access method', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-index-method', async database => {
      await installSchema(database.sql, model)
      await database.sql`
        DROP INDEX "Entity_name_trgm_idx"
      `
      await database.sql`
        CREATE INDEX "Entity_name_trgm_idx" ON "Entity" USING btree ("name")
      `
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired: model })
      expect(plan.drift).toContain('index definition changed: Entity.Entity_name_trgm_idx')
    }, { fresh: true })
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
