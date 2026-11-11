import { describe, expect, test } from 'bun:test'
import type { IsolatedDatabase } from '../testing/DatabaseIsolation'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'manager', target: 'Person', type: 'Entity' },
        {
          cardinality: 'Many',
          field: 'pets',
          inverse: 'owner',
          target: 'Pet',
          type: 'Inverse',
        },
        { field: 'scores', items: { type: 'Number' }, type: 'Array' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
        { field: 'payload', type: 'JSON' },
      ],
      name: 'Person',
    },
    {
      extends: 'Person',
      fields: [{ field: 'permissions', type: 'String' }],
      name: 'SystemUser',
    },
    {
      extends: 'Person',
      fields: [{ field: 'company', type: 'String' }],
      name: 'Client',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'age', type: 'Number' },
        { field: 'vaccinated', type: 'Boolean' },
        { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
      ],
      name: 'Pet',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
      ],
      name: 'Campaign',
    },
  ],
  relationships: [{
    between: [
      { field: 'person', inverse: 'campaigns', target: 'Person' },
      { field: 'campaign', inverse: 'members', target: 'Campaign' },
    ],
    fields: [{ field: 'role', type: 'String' }],
    name: 'Membership',
  }],
}))

/** One source/structured parity case. */
interface ParityCase {
  /** Entity being queried. */
  readonly entity: string,
  /** Expected matching IDs, when asserted. */
  readonly expected?: readonly string[],
  /** Extra query options shared by both forms. */
  readonly options?: {
    readonly collections?: Readonly<Record<string, { readonly limit?: number, readonly offset?: number }>>,
    readonly fields?: readonly string[],
    readonly limit?: number,
    readonly offset?: number,
    readonly orderBy?: string,
  },
  /** Source query. */
  readonly source: string,
  /** Structured query. */
  readonly structured: Filter | Readonly<Record<string, unknown>>,
}

const ada = '00000000-0000-4000-8000-000000000001'
const grace = '00000000-0000-4000-8000-000000000002'
const linus = '00000000-0000-4000-8000-000000000003'
const petOne = '00000000-0000-4000-8000-000000000011'
const petTwo = '00000000-0000-4000-8000-000000000012'
const petThree = '00000000-0000-4000-8000-000000000013'
const campaignOne = '00000000-0000-4000-8000-000000000021'
const campaignTwo = '00000000-0000-4000-8000-000000000022'
const campaignThree = '00000000-0000-4000-8000-000000000023'

/**
 * Seed the parity fixture.
 * @param database - Isolated PostgreSQL database.
 */
async function seed(database: IsolatedDatabase): Promise<void> {
  await database.use(definitions)
  await database.sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES (${ada},
      'Ada',
      'SystemUser'),
      (${grace},
      'Grace',
      'Client'),
      (${linus},
      'Linus',
      'SystemUser'),
      (${petOne},
      'Pet One',
      'Pet'),
      (${petTwo},
      'Pet Two',
      'Pet'),
      (${petThree},
      'Pet Three',
      'Pet'),
      (${campaignOne},
      'Campaign One',
      'Campaign'),
      (${campaignTwo},
      'Campaign Two',
      'Campaign'),
      (${campaignThree},
      'Campaign Three',
      'Campaign')
  `
  await database.sql`
    INSERT INTO "Person" ("id", "title", "manager.id", "scores", "tags", "payload")
    VALUES (${ada},
      'Ada',
      ${null},
      ARRAY[1,
      2,
      2],
      ARRAY['urgent',
      'important'],
      '{"kind":"note","meta":{"active":true}}'::jsonb),
      (${grace},
      'Grace',
      ${ada},
      ARRAY[3],
      ARRAY['urgent'],
      '{"kind":"other"}'::jsonb),
      (${linus},
      'Linus',
      ${ada},
      ARRAY[]::double precision[],
      ARRAY[]::text[],
      '{}'::jsonb)
  `
  await database.sql`
    INSERT INTO "SystemUser" ("id", "permissions")
    VALUES (${ada}, 'admin'), (${linus}, 'user')
  `
  await database.sql`
    INSERT INTO "Client" ("id", "company")
    VALUES (${grace}, 'Acme')
  `
  await database.sql`
    INSERT INTO "Pet" ("id", "age", "vaccinated", "owner.id")
VALUES (${petOne},
  3,
  TRUE,
  ${ada}),
  (${petTwo},
  8,
  TRUE,
  ${ada}),
  (${petThree},
  12,
  FALSE,
  ${grace})
  `
  await database.sql`
    INSERT INTO "Campaign" ("id", "title")
VALUES (${campaignOne},
  'Campaign One'),
  (${campaignTwo},
  'Campaign Two'),
  (${campaignThree},
  'Campaign Three')
  `
  await database.sql`
    INSERT INTO "Membership" ("person.id", "campaign.id", "role")
VALUES (${ada},
  ${campaignOne},
  'GM'),
  (${grace},
  ${campaignOne},
  'Player'),
  (${linus},
  ${campaignOne},
  'Player'),
  (${grace},
  ${campaignTwo},
  'GM')
  `
}

/**
 * Execute one parity case in both input forms.
 * @param database - Isolated PostgreSQL database.
 * @param queryCase - Source/structured case.
 * @returns Both result arrays.
 */
async function execute(
  database: IsolatedDatabase,
  queryCase: ParityCase,
): Promise<{ source: { id: string }[], structured: { id: string }[] }> {
  const options = queryCase.options ?? {}
  const shared = {
    collections: options.collections,
    fields: options.fields ?? ['id'],
    limit: options.limit,
    offset: options.offset,
    orderBy: options.orderBy ?? 'id',
  }
  const source = await queryEntity<{ id: string }>(database.sql, definitions, queryCase.entity, {
    ...shared,
    where: queryCase.source,
  })
  const structured = await queryEntity<{ id: string }>(database.sql, definitions, queryCase.entity, {
    ...shared,
    where: queryCase.structured,
  })
  return { source, structured }
}

const cases: readonly ParityCase[] = [
  {
    entity: 'Person',
    expected: [ada],
    source: "permissions = 'admin'",
    structured: { field: 'permissions', operator: Operator.Comparison.Equal, value: 'admin' },
  },
  {
    entity: 'Person',
    expected: [grace],
    source: "company = 'Acme'",
    structured: { field: 'company', operator: Operator.Comparison.Equal, value: 'Acme' },
  },
  {
    entity: 'Person',
    expected: [grace, linus],
    source: "manager.title = 'Ada'",
    structured: { 'manager.title': 'Ada' },
  },
  {
    entity: 'Person',
    expected: [grace, linus],
    source: "manager.permissions = 'admin'",
    structured: { 'manager.permissions': 'admin' },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'manager = null',
    structured: { field: 'manager', operator: Operator.Comparison.Equal, value: null },
  },
  {
    entity: 'Person',
    expected: [grace],
    source: 'pets $contains (@.age > 10)',
    structured: {
      field: 'pets',
      filters: [{ field: 'age', operator: Operator.Comparison.GreaterThan, value: 10 }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [grace],
    source: 'pets $contains (age > 10)',
    structured: {
      field: 'pets',
      filters: [{ field: 'age', operator: Operator.Comparison.GreaterThan, value: 10 }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada, linus],
    source: 'pets $all (@.vaccinated = true)',
    structured: {
      field: 'pets',
      filters: [{ field: 'vaccinated', operator: Operator.Comparison.Equal, value: true }],
      operator: Operator.Collection.All,
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: `pets $contains (@ = '${petOne}')`,
    structured: {
      field: 'pets',
      filters: [{ field: 'id', operator: Operator.Comparison.Equal, value: petOne }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'pets $empty',
    structured: { field: 'pets', operator: Operator.Comparison.Empty },
  },
  {
    entity: 'Person',
    expected: [ada, grace],
    source: 'scores $contains (@ >= 2)',
    structured: {
      field: 'scores',
      filters: [{ field: '@', operator: Operator.Comparison.GreaterThanOrEqual, value: 2 }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'scores == [1, 2]',
    structured: { field: 'scores', operator: Operator.Comparison.Equal, value: [1, 2] },
  },
  {
    entity: 'Person',
    expected: [],
    source: 'scores === [1, 2]',
    structured: { field: 'scores', operator: Operator.Comparison.SequenceEqual, value: [1, 2] },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: "tags == ['urgent', 'important']",
    structured: {
      field: 'tags',
      operator: Operator.Comparison.Equal,
      value: ['urgent', 'important'],
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: "tags === ['urgent', 'important']",
    structured: {
      field: 'tags',
      operator: Operator.Comparison.SequenceEqual,
      value: ['urgent', 'important'],
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: "tags $overlaps ['important']",
    structured: { field: 'tags', operator: Operator.Comparison.Overlaps, value: ['important'] },
  },
  {
    entity: 'Person',
    expected: [ada, grace, linus],
    source: 'scores $all (@ > 0)',
    structured: {
      field: 'scores',
      filters: [{ field: '@', operator: Operator.Comparison.GreaterThan, value: 0 }],
      operator: Operator.Collection.All,
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'scores $contains (@ > 1 $and @ < 3)',
    structured: {
      field: 'scores',
      filters: [{
        filters: [
          { field: '@', operator: Operator.Comparison.GreaterThan, value: 1 },
          { field: '@', operator: Operator.Comparison.LessThan, value: 3 },
        ],
        operator: Operator.Logical.And,
      }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada, grace],
    source: "tags $contains 'urgent'",
    structured: { field: 'tags', operator: Operator.Comparison.Contains, value: 'urgent' },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'tags $empty',
    structured: { field: 'tags', operator: Operator.Comparison.Empty },
  },
  {
    entity: 'Campaign',
    expected: [campaignOne, campaignTwo],
    source: "members $contains (@.membership.role = 'GM')",
    structured: {
      field: 'members',
      filters: [{ field: 'membership.role', operator: Operator.Comparison.Equal, value: 'GM' }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Campaign',
    expected: [campaignThree],
    source: "members $all (@.membership.role = 'Player')",
    structured: {
      field: 'members',
      filters: [{ field: 'membership.role', operator: Operator.Comparison.Equal, value: 'Player' }],
      operator: Operator.Collection.All,
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'pets.$count >= 2',
    structured: { field: 'pets.$count', operator: Operator.Comparison.GreaterThanOrEqual, value: 2 },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'pets.$count = 0',
    structured: { field: 'pets.$count', operator: Operator.Comparison.Equal, value: 0 },
  },
  {
    entity: 'Person',
    expected: [ada, grace],
    source: 'scores.$count > 0',
    structured: { field: 'scores.$count', operator: Operator.Comparison.GreaterThan, value: 0 },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'scores.$count = 0',
    structured: { field: 'scores.$count', operator: Operator.Comparison.Equal, value: 0 },
  },
  {
    entity: 'Campaign',
    expected: [campaignOne],
    source: 'members.$count >= 3',
    structured: { field: 'members.$count', operator: Operator.Comparison.GreaterThanOrEqual, value: 3 },
  },
  {
    entity: 'Campaign',
    expected: [campaignThree],
    source: 'members.$count = 0',
    structured: { field: 'members.$count', operator: Operator.Comparison.Equal, value: 0 },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'payload $contains {kind: "note"}',
    structured: { field: 'payload', operator: Operator.Comparison.Contains, value: { kind: 'note' } },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'payload $contains {meta: {active: true}}',
    structured: {
      field: 'payload',
      operator: Operator.Comparison.Contains,
      value: { meta: { active: true } },
    },
  },
]

describe('Query parity gate', () => {
  test('matches source and structured filters against real PostgreSQL', async () => {
    await withIsolatedDatabase('query-parity', async database => {
      await seed(database)
      for (const queryCase of cases) {
        const result = await execute(database, queryCase)
        expect(result.source).toEqual(result.structured)
        if (queryCase.expected) {
          expect(result.source.map(row => row.id)).toEqual([...(queryCase.expected ?? [])])
        }
        expect(compileEntityQuery(definitions, queryCase.entity, {
          fields: queryCase.options?.fields ?? ['id'],
          where: queryCase.source,
        }).sql).toBe(compileEntityQuery(definitions, queryCase.entity, {
          fields: queryCase.options?.fields ?? ['id'],
          where: queryCase.structured,
        }).sql)
      }

      const paged: ParityCase = {
        entity: 'Person',
        expected: [grace],
        options: {
          collections: { pets: { limit: 1, offset: 0 } },
          fields: ['id', 'pets'],
          limit: 1,
          offset: 1,
          orderBy: 'title',
        },
        source: 'pets $contains (@.age > 0)',
        structured: {
          field: 'pets',
          filters: [{ field: 'age', operator: Operator.Comparison.GreaterThan, value: 0 }],
          operator: Operator.Comparison.Contains,
        },
      }
      const result = await execute(database, paged)
      expect(result.source).toEqual(result.structured)
      expect(result.source.map(row => row.id)).toEqual([...(paged.expected ?? [])])

      const projected = await queryEntity<{
        readonly 'id': string,
        readonly 'pets.$count': number,
        readonly 'scores.$count': number,
      }>(database.sql, definitions, 'Person', {
        fields: ['id', 'pets.$count', 'scores.$count'],
        orderBy: 'id',
      })
      expect(projected).toEqual([
        { 'id': ada, 'pets.$count': 2, 'scores.$count': 3 },
        { 'id': grace, 'pets.$count': 1, 'scores.$count': 1 },
        { 'id': linus, 'pets.$count': 0, 'scores.$count': 0 },
      ])

      const ordered = await queryEntity<{ id: string }>(database.sql, definitions, 'Person', {
        fields: ['id'],
        orderBy: 'pets.$count',
        where: 'pets.$count >= 0',
      })
      expect(ordered.map(row => row.id)).toEqual([linus, grace, ada])
    })
  }, 120_000)
})
