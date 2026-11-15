import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { installSchema } from '../testing/Schema'
import { EntityDefinitions } from './EntityDefinitions'
import { Action, Graph, Security } from './Graph'
import type { AuthoredEntity, AuthoredSecurity } from './GraphAuthoring'
import { DDL } from './Schema'

/** Public-read security used by simple planning fixtures. */
const publicRead: AuthoredSecurity = { [Action.Read]: Security.Public }

/**
 * Build the standard Note entity with an explicit read policy.
 * @param security - Security declaration; defaults to public read.
 * @returns Authored Note entity.
 */
function noteEntity(security: AuthoredSecurity = publicRead): AuthoredEntity {
  return { fields: [{ field: 'title', type: 'String' }], name: 'Note', security }
}

/**
 * Build an inherited Profile/Employee fixture with an Employee read predicate.
 * @param email - Employee email predicate value.
 * @returns Profile and Employee declarations.
 */
function employeeEntities(email: string): readonly AuthoredEntity[] {
  return [
    { fields: [{ field: 'email', type: 'String' }], name: 'Profile' },
    {
      extends: 'Profile',
      fields: [],
      name: 'Employee',
      security: { [Action.Read]: { where: `email = '${email}'` } },
    },
  ]
}

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

  test('enforces named enum allowed values through real PostgreSQL checks', async () => {
    const model = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { enum: 'AccessLevel', field: 'access', type: 'Enum' },
          { enum: 'AccessLevel', field: 'fallback', nullable: true, type: 'Enum' },
        ],
        name: 'EnumRecord',
      }],
      enums: {
        AccessLevel: {
          editor: 'Can edit resources.',
          owner: 'Can manage resources and membership.',
          viewer: 'Can view resources.',
        },
      },
    }))
    await withIsolatedDatabase('schema-enum-check', async database => {
      await installSchema(database.sql, model)
      const id = randomUUID()
      await database.sql.unsafe(
        'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
        [id, 'Record', 'EnumRecord'],
      )
      await database.sql.unsafe(
        'INSERT INTO "EnumRecord" ("id", "access", "fallback") VALUES ($1, $2, $3)',
        [id, 'owner', null],
      )
      const rows = await database.sql.unsafe(
        'SELECT "access", "fallback" FROM "EnumRecord" WHERE "id" = $1',
        [id],
      )
      expect(rows).toEqual([{ access: 'owner', fallback: null }])

      const invalid = await database.captureError(async () => {
        await database.sql.unsafe(
          'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
          [randomUUID(), 'Invalid', 'EnumRecord'],
        )
        await database.sql.unsafe(
          'INSERT INTO "EnumRecord" ("id", "access") VALUES ($1, $2)',
          [randomUUID(), 'not-a-level'],
        )
      })
      expect(String(invalid)).toContain('EnumRecord_access_enum_check')
    }, { fresh: true })
  })

  test('plans and applies enum value-set changes through reviewed checks', async () => {
    const model = (values: readonly string[]): EntityDefinitions => EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{ enum: 'AccessLevel', field: 'access', type: 'Enum' }],
        name: 'EnumRecord',
      }],
      enums: {
        AccessLevel: Object.fromEntries(values.map(value => [value, `${value} access.`])),
      },
    }))
    const first = model(['owner', 'editor'])
    const added = model(['owner', 'editor', 'viewer'])
    await withIsolatedDatabase('schema-enum-value-add', async database => {
      await installSchema(database.sql, first)
      const installed = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual: installed,
        desired: added,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(plan.drift).toEqual([])
      expect(plan.operations.map(operation => operation.id)).toContain(
        'check:EnumRecord:EnumRecord_access_enum_check',
      )
      expect(plan.operations.find(operation => operation.id === 'check-drop:EnumRecord:EnumRecord_access_enum_check'))
        .toBeDefined()
      await installSchema(database.sql, added, {
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      const upgraded = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: upgraded,
        desired: added,
        previous: added,
        previousPhysical: added.physicalSchema(),
      })).toMatchObject({ drift: [], operations: [] })
      const id = randomUUID()
      await database.sql.unsafe(
        'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
        [id, 'Added', 'EnumRecord'],
      )
      await database.sql.unsafe(
        'INSERT INTO "EnumRecord" ("id", "access") VALUES ($1, $2)',
        [id, 'viewer'],
      )
    }, { fresh: true })
  })

  test('plans enum value removals and reports missing or changed checks as drift', async () => {
    const model = (values: readonly string[]): EntityDefinitions => EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{ enum: 'AccessLevel', field: 'access', type: 'Enum' }],
        name: 'EnumRecord',
      }],
      enums: {
        AccessLevel: Object.fromEntries(values.map(value => [value, `${value} access.`])),
      },
    }))
    const first = model(['owner', 'editor'])
    const removed = model(['owner'])
    await withIsolatedDatabase('schema-enum-value-remove', async database => {
      await installSchema(database.sql, first)
      const installed = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual: installed,
        desired: removed,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(plan.drift).toEqual([])
      expect(plan.operations.map(operation => operation.id)).toEqual(expect.arrayContaining([
        'check-drop:EnumRecord:EnumRecord_access_enum_check',
        'check:EnumRecord:EnumRecord_access_enum_check',
      ]))
      await installSchema(database.sql, removed, {
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      const id = randomUUID()
      await database.sql.unsafe(
        'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
        [id, 'Removed', 'EnumRecord'],
      )
      const invalid = await database.captureError(async () => {
        await database.sql.unsafe(
          'INSERT INTO "EnumRecord" ("id", "access") VALUES ($1, $2)',
          [randomUUID(), 'editor'],
        )
      })
      expect(String(invalid)).toContain('EnumRecord_access_enum_check')

      await database.sql.unsafe(
        'ALTER TABLE "EnumRecord" DROP CONSTRAINT "EnumRecord_access_enum_check"',
      )
      const missing = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: missing,
        desired: removed,
        previous: removed,
        previousPhysical: removed.physicalSchema(),
      }).drift.join(' ')).toContain('missing deployed check: EnumRecord.EnumRecord_access_enum_check')
    }, { fresh: true })
  })

  test('treats a weakened live enum check as drift', async () => {
    const model = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{ enum: 'AccessLevel', field: 'access', type: 'Enum' }],
        name: 'EnumRecord',
      }],
      enums: { AccessLevel: { editor: 'Editor access.', owner: 'Owner access.' } },
    }))
    await withIsolatedDatabase('schema-enum-tamper', async database => {
      await installSchema(database.sql, model)
      await database.sql
        .unsafe('ALTER TABLE "EnumRecord" DROP CONSTRAINT "EnumRecord_access_enum_check"')
        .simple()
      await database.sql
        .unsafe('ALTER TABLE "EnumRecord" ADD CONSTRAINT "EnumRecord_access_enum_check" CHECK ("access" IS NOT NULL)')
        .simple()
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        desired: model,
        previous: model,
        previousPhysical: model.physicalSchema(),
      })
      expect(plan.drift.join(' ')).toContain(
        'check definition changed: EnumRecord.EnumRecord_access_enum_check',
      )
      expect(plan.blocked).toBe(true)

      await database.sql
        .unsafe('ALTER TABLE "EnumRecord" DROP CONSTRAINT "EnumRecord_access_enum_check"')
        .simple()
      await database.sql.unsafe(
        'ALTER TABLE "EnumRecord" ADD CONSTRAINT "EnumRecord_access_enum_check" ' +
        'CHECK ("access" IN (\'editor\', \'owner\') OR TRUE)',
      ).simple()
      const weakenedValues = await DDL.introspect(database.sql)
      const weakenedPlan = DDL.plan({
        actual: weakenedValues,
        desired: model,
        previous: model,
        previousPhysical: model.physicalSchema(),
      })
      expect(weakenedPlan.drift.join(' ')).toContain(
        'check definition changed: EnumRecord.EnumRecord_access_enum_check',
      )
      expect(weakenedPlan.blocked).toBe(true)
    }, { fresh: true })
  })

  test('treats enum description edits as metadata-only changes', async () => {
    const model = (owner: string): EntityDefinitions => EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ enum: 'AccessLevel', field: 'access', type: 'Enum' }], name: 'EnumRecord' }],
      enums: { AccessLevel: { owner, viewer: 'Can view resources.' } },
    }))
    const first = model('Can manage resources.')
    const second = model('Can administer resources.')
    expect(first.ddl).toEqual(second.ddl)
    await withIsolatedDatabase('schema-enum-description', async database => {
      await installSchema(database.sql, first)
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({
        actual,
        desired: second,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(plan.drift).toEqual([])
      expect(plan.operations).toEqual([])
    }, { fresh: true })
  })

  test('applies typed empty array defaults to omitted columns', async () => {
    const model = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { default: [], field: 'strings', items: { type: 'String' }, type: 'Array' },
          { default: [], field: 'numbers', items: { type: 'Number' }, type: 'Array' },
          { default: [], field: 'booleans', items: { type: 'Boolean' }, type: 'Array' },
          { default: [], field: 'dates', items: { type: 'Date' }, type: 'Array' },
          { default: [], field: 'timestamps', items: { type: 'Timestamp' }, type: 'Array' },
          { default: [], field: 'identities', items: { type: 'ID' }, type: 'Array' },
        ],
        name: 'ArrayDefaults',
      }],
    }))
    await withIsolatedDatabase('schema-empty-array-defaults', async database => {
      await installSchema(database.sql, model)
      const id = randomUUID()
      await database.sql.unsafe(
        'INSERT INTO "Entity" ("id", "name", "entity") VALUES ($1, $2, $3)',
        [id, 'Defaults', 'ArrayDefaults'],
      )
      await database.sql.unsafe('INSERT INTO "ArrayDefaults" ("id") VALUES ($1)', [id])
      const [row] = await database.sql.unsafe(
        'SELECT cardinality("strings") AS strings, cardinality("numbers") AS numbers, ' +
        'cardinality("booleans") AS booleans, cardinality("dates") AS dates, ' +
        'cardinality("timestamps") AS timestamps, cardinality("identities") AS identities ' +
        'FROM "ArrayDefaults" WHERE "id" = $1',
        [id],
      )
      expect(row).toEqual({
        booleans: 0,
        dates: 0,
        identities: 0,
        numbers: 0,
        strings: 0,
        timestamps: 0,
      })
    }, { fresh: true })
  })

  test('evolves declared defaults without false drift', async () => {
    const model = (value?: string): EntityDefinitions => EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{
          field: 'label',
          type: 'String',
          ...(value === undefined ? {} : { default: value }),
        }],
        name: 'Note',
      }],
    }))
    const first = model('a')
    const second = model('b')
    const removed = model()
    await withIsolatedDatabase('schema-default-evolution', async database => {
      await installSchema(database.sql, first)
      const installed = await DDL.introspect(database.sql)
      const stable = DDL.plan({
        actual: installed,
        desired: first,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(stable.drift).toEqual([])
      expect(stable.operations).toEqual([])

      const introduced = DDL.plan({
        actual: installed,
        desired: second,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(introduced.operations.find(operation => operation.id === 'column-default:Note:label')?.sql)
        .toContain("SET DEFAULT 'b'")
      await installSchema(database.sql, second, {
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      const changed = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: changed,
        desired: second,
        previous: second,
        previousPhysical: second.physicalSchema(),
      }).drift).toEqual([])

      const dropped = DDL.plan({
        actual: changed,
        desired: removed,
        previous: second,
        previousPhysical: second.physicalSchema(),
      })
      expect(dropped.operations.find(operation => operation.id === 'column-default:Note:label')?.sql)
        .toContain('DROP DEFAULT')
      await installSchema(database.sql, removed, {
        previous: second,
        previousPhysical: second.physicalSchema(),
      })
      const droppedInstalled = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: droppedInstalled,
        desired: removed,
        previous: removed,
        previousPhysical: removed.physicalSchema(),
      }).drift).toEqual([])

      await database.sql.unsafe('ALTER TABLE "Note" ALTER COLUMN "label" SET DEFAULT \'out-of-band\'').simple()
      const outOfBand = await DDL.introspect(database.sql)
      const drift = DDL.plan({
        actual: outOfBand,
        desired: removed,
        previous: removed,
        previousPhysical: removed.physicalSchema(),
      })
      expect(drift.drift.join(' ')).toContain('column default changed')
    }, { fresh: true })
  })

  test('compares default expressions without conflating literal contents', async () => {
    const model = (label: string, role: string): EntityDefinitions => EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { default: '2020-01-01T00:00:00.000Z', field: 'createdAt', type: 'Timestamp' },
          { default: label, field: 'label', type: 'String' },
          { default: { role }, field: 'payload', type: 'JSON' },
        ],
        name: 'LiteralDefault',
      }],
    }))
    const first = model('a', 'admin')
    const changed = model('a::text', 'admin::text')
    await withIsolatedDatabase('schema-default-literals', async database => {
      await installSchema(database.sql, first)
      const installed = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: installed,
        desired: first,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })).toMatchObject({ drift: [], operations: [] })

      const plan = DDL.plan({
        actual: installed,
        desired: changed,
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      expect(plan.drift).toEqual([])
      expect(plan.operations.find(operation => operation.id === 'column-default:LiteralDefault:label')?.sql)
        .toContain("SET DEFAULT 'a::text'")
      expect(plan.operations.find(operation => operation.id === 'column-default:LiteralDefault:payload')?.sql)
        .toContain('admin::text')

      await installSchema(database.sql, changed, {
        previous: first,
        previousPhysical: first.physicalSchema(),
      })
      const changedInstalled = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: changedInstalled,
        desired: changed,
        previous: changed,
        previousPhysical: changed.physicalSchema(),
      })).toMatchObject({ drift: [], operations: [] })

      await database.sql.unsafe(
        'ALTER TABLE "LiteralDefault" ALTER COLUMN "label" SET DEFAULT \'out-of-band::text\'',
      ).simple()
      const outOfBand = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: outOfBand,
        desired: changed,
        previous: changed,
        previousPhysical: changed.physicalSchema(),
      }).drift.join(' ')).toContain('column default changed')
    }, { fresh: true })
  })

  test('plans reviewed identity changes to unique indexes', async () => {
    const unique = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{ field: 'title', type: 'String', unique: true }],
        name: 'Note',
      }],
    }))
    const plain = EntityDefinitions.load(JSON.stringify({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'Note' }],
    }))
    await withIsolatedDatabase('schema-unique-evolution', async database => {
      await installSchema(database.sql, unique)
      const actual = await DDL.introspect(database.sql)
      const remove = DDL.plan({
        actual,
        desired: plain,
        previous: unique,
        previousPhysical: unique.physicalSchema(),
      })
      expect(remove.operations.some(operation => operation.id === 'index-drop:Note:Note_title_unique'))
        .toBe(true)
      expect(remove.drift).toEqual([])
      await installSchema(database.sql, plain, {
        previous: unique,
        previousPhysical: unique.physicalSchema(),
      })
      const plainActual = await DDL.introspect(database.sql)
      expect(DDL.plan({
        actual: plainActual,
        desired: plain,
        previous: plain,
        previousPhysical: plain.physicalSchema(),
      }).drift).toEqual([])

      await database.sql.unsafe('CREATE UNIQUE INDEX "Note_title_unique" ON "Note" ("title")').simple()
      const outOfBand = await DDL.introspect(database.sql)
      const drift = DDL.plan({
        actual: outOfBand,
        desired: plain,
        previous: plain,
        previousPhysical: plain.physicalSchema(),
      })
      expect(drift.drift.join(' ')).toContain('unexpected index')
    }, { fresh: true })
  })

  test('enforces single and composite uniqueness on PostgreSQL', async () => {
    const model = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', nullable: true, type: 'String', unique: true },
          ],
          name: 'User',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'title', type: 'String' },
          ],
          name: 'Campaign',
        },
        {
          constraints: [{
            description: 'Each user may only have one Membership per Campaign.',
            fields: ['userId', 'campaignId'],
            name: 'One Membership Per Campaign',
            type: 'Uniqueness',
          }],
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'userId', target: 'User', type: 'Entity' },
            { field: 'campaignId', target: 'Campaign', type: 'Entity' },
          ],
          name: 'Membership',
        },
      ],
    }))
    await withIsolatedDatabase('schema-unique', async database => {
      await installSchema(database.sql, model)
      const userId = randomUUID()
      const otherUserId = randomUUID()
      const campaignId = randomUUID()
      const otherCampaignId = randomUUID()
      const insertEntity = async (id: string, name: string, entity: string) => {
        await database.sql`
          INSERT INTO "Entity" ("id", "name", "entity")
          VALUES (${id}, ${name}, ${entity})
        `
      }
      await insertEntity(userId, 'user@example.com', 'User')
      await insertEntity(otherUserId, 'other@example.com', 'User')
      await insertEntity(campaignId, 'Campaign', 'Campaign')
      await insertEntity(otherCampaignId, 'Other Campaign', 'Campaign')
      await database.sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${userId}, 'user@example.com')
      `
      await database.sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${otherUserId}, NULL)
      `
      const nullEmailId = randomUUID()
      await insertEntity(nullEmailId, 'null@example.com', 'User')
      await database.sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${nullEmailId}, NULL)
      `
      await database.sql`
        INSERT INTO "Campaign" ("id", "title")
        VALUES (${campaignId}, 'Campaign')
      `
      await database.sql`
        INSERT INTO "Campaign" ("id", "title")
        VALUES (${otherCampaignId}, 'Other Campaign')
      `
      const membership = randomUUID()
      await insertEntity(membership, 'Membership', 'Membership')
      await database.sql`
        INSERT INTO "Membership" ("id", "userId.id", "campaignId.id")
        VALUES (${membership}, ${userId}, ${campaignId})
      `
      const duplicateId = randomUUID()
      await insertEntity(duplicateId, 'Duplicate Membership', 'Membership')
      await expect(database.captureError(async () => database.sql`
        INSERT INTO "Membership" ("id", "userId.id", "campaignId.id")
        VALUES (${duplicateId}, ${userId}, ${campaignId})
      `)).resolves.toBeInstanceOf(Error)
      const distinctId = randomUUID()
      await insertEntity(distinctId, 'Distinct Membership', 'Membership')
      await database.sql`
        INSERT INTO "Membership" ("id", "userId.id", "campaignId.id")
        VALUES (${distinctId}, ${otherUserId}, ${campaignId})
      `
      const nullRightId = randomUUID()
      await insertEntity(nullRightId, 'Null Right Membership', 'Membership')
      await expect(database.sql`
        INSERT INTO "Membership" ("id", "userId.id", "campaignId.id")
        VALUES (${nullRightId}, ${otherUserId}, NULL)
      `).resolves.toBeDefined()
      const nullLeftId = randomUUID()
      await insertEntity(nullLeftId, 'Null Left Membership', 'Membership')
      await expect(database.sql`
        INSERT INTO "Membership" ("id", "userId.id", "campaignId.id")
        VALUES (${nullLeftId}, ${userId}, NULL)
      `).resolves.toBeDefined()
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
      entities: [noteEntity()],
    })
    const desired = new Graph({
      entities: [
        noteEntity(),
        { fields: [{ field: 'title', type: 'String' }], name: 'Tag', security: publicRead },
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
      entities: [noteEntity()],
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
      entities: [noteEntity()],
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
    const fields = [
      { field: 'title', type: 'String' },
      { field: 'active', type: 'Boolean' },
    ] as const
    const literal = new Graph({
      entities: [{
        fields,
        name: 'Note',
        security: { [Action.Read]: { where: "title = 'a b'" } },
      }],
    })
    const literalChanged = new Graph({
      entities: [{
        fields,
        name: 'Note',
        security: { [Action.Read]: { where: "title = 'ab'" } },
      }],
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
      entities: [{
        fields,
        name: 'Note',
        security: { [Action.Read]: { where: "title = 'x' $and active = true" } },
      }],
    })
    const right = new Graph({
      entities: [{
        fields,
        name: 'Note',
        security: { [Action.Read]: { where: "title = 'x' $or active = true" } },
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
      entities: [noteEntity()],
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
      entities: [noteEntity()],
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
    const left = new Graph({
      entities: [{
        fields: [
          { field: 'details', type: 'JSON' },
          { field: 'active', type: 'Boolean' },
        ],
        name: 'Note',
        security: {
          [Action.Read]: {
            where: {
              filters: [
                { field: 'details', operator: '$contains', value: { type: 'safe' } },
                { field: 'active', operator: '$eq', value: true },
              ],
              operator: '$and',
            },
          },
        },
      }],
    })
    const right = new Graph({
      entities: [{
        fields: [
          { field: 'details', type: 'JSON' },
          { field: 'active', type: 'Boolean' },
        ],
        name: 'Note',
        security: {
          [Action.Read]: {
            where: {
              filters: [
                { field: 'details', operator: '$contains', value: { type: 'safe' } },
                { field: 'active', operator: '$eq', value: true },
              ],
              operator: '$or',
            },
          },
        },
      }],
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

  test.serial('plans real catalog policy and role changes', async () => {
    await withIsolatedDatabase('schema-plan-catalog-policy', async database => {
      const appRole = `basis_plan_app_${randomUUID().replaceAll('-', '').slice(0, 12)}`
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      const previous = new Graph({
        entities: [noteEntity()],
        roles: { editor: { name: 'Editor' } },
        schema: database.schema,
      })
      const desired = new Graph({
        entities: [noteEntity()],
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
      entities: [noteEntity()],
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
    const previous = new Graph({
      entities: employeeEntities('x'),
    })
    const desired = new Graph({
      entities: employeeEntities('y'),
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

  test.serial('executes the ordered policy/helper replacement sequence in PostgreSQL', async () => {
    await withIsolatedDatabase('schema-plan-catalog-helper', async database => {
      const appRole = `basis_plan_helper_${randomUUID().replaceAll('-', '').slice(0, 12)}`
      await database.sql.unsafe(`CREATE ROLE "${appRole}" NOLOGIN`).simple()
      const previous = new Graph({
        entities: employeeEntities('x'),
        schema: database.schema,
      })
      const desired = new Graph({
        entities: employeeEntities('y'),
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
      entities: [noteEntity()],
      roles: { editor: { name: 'Editor' } },
    })
    const desired = new Graph({
      entities: [noteEntity()],
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
      entities: [noteEntity({ [Action.Read]: { where: "title = 'x'" } })],
    })
    const desired = new Graph({
      entities: [noteEntity({ [Action.Read]: { where: "title = 'y'" } })],
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
        {
          extends: 'Profile',
          fields: [],
          name: 'Employee',
          security: { [Action.Read]: { where: "email = 'x'" } },
        },
      ],
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

  test.serial('revokes public schema CREATE through the reviewed graph plan', async () => {
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

  test('detects a nondefault operator class on a canonical default B-tree', async () => {
    const model = definitions()
    await withIsolatedDatabase('schema-index-opclass', async database => {
      await installSchema(database.sql, model)
      await database.sql`
        DROP INDEX "Entity_name_id_idx"
      `
      await database.sql`
        CREATE INDEX "Entity_name_id_idx" ON "Entity" USING btree ("name" text_pattern_ops, "id")
      `
      const actual = await DDL.introspect(database.sql)
      const plan = DDL.plan({ actual, desired: model })
      expect(plan.drift).toContain('index definition changed: Entity.Entity_name_id_idx')
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
      entities: [noteEntity()],
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
