import { describe, expect, test } from 'bun:test'
import type { LifecycleDatabase } from '../testing/DatabaseLifecycle'
import { withLifecycleDatabase } from '../testing/DatabaseLifecycle'
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
        { field: 'primaryTag', type: 'String' },
        { field: 'manager', target: 'Person', type: 'Entity' },
        { field: 'favoriteIds', items: { format: 'UUID', type: 'ID' }, type: 'Array' },
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
        {
          cardinality: 'Many',
          field: 'toys',
          inverse: 'pet',
          target: 'Toy',
          type: 'Inverse',
        },
      ],
      name: 'Pet',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'pet', inverse: 'toys', target: 'Pet', type: 'Entity' },
      ],
      name: 'Toy',
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

const eligibilityEntities = [
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'label', type: 'String' },
    ],
    name: 'A',
  },
  {
    extends: 'A',
    fields: [
      { field: 'foo', nullable: true, type: 'Number' },
      { field: 'scores', items: { type: 'Number' }, type: 'Array' },
      {
        cardinality: 'Many',
        field: 'items',
        inverse: 'ownerB',
        target: 'Item',
        type: 'Inverse',
      },
    ],
    name: 'B',
  },
  {
    extends: 'A',
    fields: [
      { field: 'foo', nullable: true, type: 'Number' },
      {
        cardinality: 'Many',
        field: 'items',
        inverse: 'ownerC',
        target: 'Item',
        type: 'Inverse',
      },
    ],
    name: 'C',
  },
  { extends: 'A', fields: [], name: 'D' },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'title', type: 'String' },
      { field: 'ownerB', inverse: 'items', target: 'B', type: 'Entity' },
      { field: 'ownerC', inverse: 'items', target: 'C', type: 'Entity' },
    ],
    name: 'Item',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'document', target: 'Document', type: 'Entity' },
    ],
    name: 'Section',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'code', type: 'String' },
    ],
    name: 'Document',
  },
  { extends: 'Document', fields: [], name: 'PublicDocument' },
  {
    extends: 'Document',
    fields: [
      { field: 'secret', type: 'String' },
      { field: 'workspace', target: 'Workspace', type: 'Entity' },
    ],
    name: 'PrivateDocument',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      {
        cardinality: 'Many',
        field: 'members',
        inverse: 'workspace',
        target: 'Member',
        type: 'Inverse',
      },
    ],
    name: 'Workspace',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'workspace', inverse: 'members', target: 'Workspace', type: 'Entity' },
    ],
    name: 'Member',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      {
        cardinality: 'Many',
        field: 'members',
        inverse: 'owner',
        target: 'TeamMember',
        type: 'Inverse',
      },
    ],
    name: 'Owner',
  },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'owner', inverse: 'members', target: 'Owner', type: 'Entity' },
    ],
    name: 'TeamMember',
  },
  {
    extends: 'TeamMember',
    fields: [
      {
        cardinality: 'Many',
        field: 'tickets',
        inverse: 'admin',
        target: 'Ticket',
        type: 'Inverse',
      },
      { field: 'scores', items: { type: 'Number' }, type: 'Array' },
    ],
    name: 'AdminTeamMember',
  },
  { extends: 'TeamMember', fields: [], name: 'GuestTeamMember' },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'title', type: 'String' },
      { field: 'admin', inverse: 'tickets', target: 'AdminTeamMember', type: 'Entity' },
    ],
    name: 'Ticket',
  },
]
const eligibilityDefinitions = EntityDefinitions.load(JSON.stringify({ entities: eligibilityEntities }))
const eligibilityDefinitionsReversed = EntityDefinitions.load(JSON.stringify({
  entities: [
    eligibilityEntities[0],
    eligibilityEntities[2],
    eligibilityEntities[1],
    ...eligibilityEntities.slice(3),
  ],
}))

const eligibilityB1 = '00000000-0000-4000-8000-000000000101'
const eligibilityB2 = '00000000-0000-4000-8000-000000000102'
const eligibilityB3 = '00000000-0000-4000-8000-000000000103'
const eligibilityC1 = '00000000-0000-4000-8000-000000000111'
const eligibilityC2 = '00000000-0000-4000-8000-000000000112'
const eligibilityC3 = '00000000-0000-4000-8000-000000000113'
const eligibilityD1 = '00000000-0000-4000-8000-000000000121'
const eligibilityItem1 = '00000000-0000-4000-8000-000000000201'
const eligibilityItem2 = '00000000-0000-4000-8000-000000000202'
const eligibilityItem3 = '00000000-0000-4000-8000-000000000203'
const eligibilityItem4 = '00000000-0000-4000-8000-000000000204'
const eligibilitySection1 = '00000000-0000-4000-8000-000000000301'
const eligibilitySection2 = '00000000-0000-4000-8000-000000000302'
const eligibilitySection3 = '00000000-0000-4000-8000-000000000303'
const eligibilityPublicDoc = '00000000-0000-4000-8000-000000000311'
const eligibilityPrivateDoc = '00000000-0000-4000-8000-000000000312'
const eligibilityPrivateDocTwo = '00000000-0000-4000-8000-000000000313'
const eligibilityWorkspaceOne = '00000000-0000-4000-8000-000000000321'
const eligibilityWorkspaceTwo = '00000000-0000-4000-8000-000000000322'
const eligibilityMemberOne = '00000000-0000-4000-8000-000000000331'
const eligibilityOwnerOne = '00000000-0000-4000-8000-000000000341'
const eligibilityOwnerTwo = '00000000-0000-4000-8000-000000000342'
const eligibilityAdminOne = '00000000-0000-4000-8000-000000000351'
const eligibilityAdminTwo = '00000000-0000-4000-8000-000000000352'
const eligibilityGuestOne = '00000000-0000-4000-8000-000000000353'
const eligibilityGuestTwo = '00000000-0000-4000-8000-000000000354'
const eligibilityTicketOne = '00000000-0000-4000-8000-000000000361'

/** One source/structured parity case. */
interface ParityCase {
  /** Entity being queried. */
  readonly entity: string,
  /** Expected matching IDs, when asserted. */
  readonly expected?: readonly string[],
  /** Extra query options shared by both forms. */
  readonly options?: {
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
const toyOne = '00000000-0000-4000-8000-000000000031'
const toyTwo = '00000000-0000-4000-8000-000000000032'

/**
 * Seed the parity fixture.
 * @param database - Isolated PostgreSQL database.
 */
async function seed(database: LifecycleDatabase): Promise<void> {
  await database.use(definitions)
  await database.sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${ada}, 'Ada', 'SystemUser'),
      (${grace}, 'Grace', 'Client'),
      (${linus}, 'Linus', 'SystemUser'),
      (${petOne}, 'Pet One', 'Pet'),
      (${petTwo}, 'Pet Two', 'Pet'),
      (${petThree}, 'Pet Three', 'Pet'),
      (${toyOne}, 'Ball', 'Toy'),
      (${toyTwo}, 'Bone', 'Toy'),
      (${campaignOne}, 'Campaign One', 'Campaign'),
      (${campaignTwo}, 'Campaign Two', 'Campaign'),
      (${campaignThree}, 'Campaign Three', 'Campaign')
  `
  await database.sql`
    INSERT INTO "Person" (
      "id",
      "title",
      "primaryTag",
      "manager.id",
      "favoriteIds",
      "scores",
      "tags",
      "payload"
    )
    VALUES
      (
        ${ada},
        'Ada',
        'urgent',
        ${null},
        ARRAY [${ada}, ${grace}]::TEXT[],
        ARRAY [1, 2, 2],
        ARRAY ['urgent', 'important'],
        '{"kind":"note","meta":{"active":true}}'::JSONB
      ),
      (
        ${grace},
        'Grace',
        'important',
        ${ada},
        ARRAY [${grace}]::TEXT[],
        ARRAY [3],
        ARRAY ['urgent'],
        '{"kind":"other"}'::JSONB
      ),
      (
        ${linus},
        'Linus',
        '',
        ${ada},
        ARRAY []::TEXT[],
        ARRAY []::DOUBLE PRECISION[],
        ARRAY []::TEXT[],
        '{}'::JSONB
      )
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
    VALUES
      (${petOne}, 3, TRUE, ${ada}),
      (${petTwo}, 8, TRUE, ${ada}),
      (${petThree}, 12, FALSE, ${grace})
  `
  await database.sql`
    INSERT INTO "Toy" ("id", "title", "pet.id")
    VALUES
      (${toyOne}, 'ball', ${petOne}),
      (${toyTwo}, 'bone', ${petTwo})
  `
  await database.sql`
    INSERT INTO "Campaign" ("id", "title")
    VALUES
      (${campaignOne}, 'Campaign One'),
      (${campaignTwo}, 'Campaign Two'),
      (${campaignThree}, 'Campaign Three')
  `
  await database.sql`
    INSERT INTO "Membership" ("person.id", "campaign.id", "role")
    VALUES
      (${ada}, ${campaignOne}, 'GM'),
      (${grace}, ${campaignOne}, 'Player'),
      (${linus}, ${campaignOne}, 'Player'),
      (${grace}, ${campaignTwo}, 'GM')
  `
}

/**
 * Seed the polymorphic eligibility fixture.
 * @param database - Isolated PostgreSQL database.
 * @param model - Entity definitions to install.
 */
async function seedEligibility(
  database: LifecycleDatabase,
  model = eligibilityDefinitions,
): Promise<void> {
  await database.use(model)
  await database.sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${eligibilityB1}, 'B1', 'B'),
      (${eligibilityB2}, 'B2', 'B'),
      (${eligibilityB3}, 'B3', 'B'),
      (${eligibilityC1}, 'C1', 'C'),
      (${eligibilityC2}, 'C2', 'C'),
      (${eligibilityC3}, 'C3', 'C'),
      (${eligibilityD1}, 'D1', 'D'),
      (${eligibilityItem1}, 'Item 1', 'Item'),
      (${eligibilityItem2}, 'Item 2', 'Item'),
      (${eligibilityItem3}, 'Item 3', 'Item'),
      (${eligibilityItem4}, 'Item 4', 'Item'),
      (${eligibilitySection1}, 'Section 1', 'Section'),
      (${eligibilitySection2}, 'Section 2', 'Section'),
      (${eligibilitySection3}, 'Section 3', 'Section'),
      (${eligibilityPublicDoc}, 'Public Document', 'PublicDocument'),
      (${eligibilityPrivateDoc}, 'Private Document', 'PrivateDocument'),
      (${eligibilityPrivateDocTwo}, 'Private Document Two', 'PrivateDocument'),
      (${eligibilityWorkspaceOne}, 'Workspace One', 'Workspace'),
      (${eligibilityWorkspaceTwo}, 'Workspace Two', 'Workspace'),
      (${eligibilityMemberOne}, 'Member One', 'Member'),
      (${eligibilityOwnerOne}, 'Owner One', 'Owner'),
      (${eligibilityOwnerTwo}, 'Owner Two', 'Owner'),
      (${eligibilityAdminOne}, 'Admin One', 'AdminTeamMember'),
      (${eligibilityAdminTwo}, 'Admin Two', 'AdminTeamMember'),
      (${eligibilityGuestOne}, 'Guest One', 'GuestTeamMember'),
      (${eligibilityGuestTwo}, 'Guest Two', 'GuestTeamMember'),
      (${eligibilityTicketOne}, 'Urgent', 'Ticket')
  `
  await database.sql`
    INSERT INTO "A" ("id", "label")
    VALUES
      (${eligibilityB1}, 'b7'),
      (${eligibilityB2}, 'bnull'),
      (${eligibilityB3}, 'b8'),
      (${eligibilityC1}, 'c7'),
      (${eligibilityC2}, 'cnull'),
      (${eligibilityC3}, 'c9'),
      (${eligibilityD1}, 'd')
  `
  await database.sql`
    INSERT INTO "B" ("id", "foo", "scores")
    VALUES
      (${eligibilityB1}, 7, ARRAY [1, 2]::DOUBLE PRECISION[]),
      (${eligibilityB2}, ${null}, ARRAY []::DOUBLE PRECISION[]),
      (${eligibilityB3}, 8, ARRAY [3]::DOUBLE PRECISION[])
  `
  await database.sql`
    INSERT INTO "C" ("id", "foo")
    VALUES (${eligibilityC1}, 7), (${eligibilityC2}, ${null}), (${eligibilityC3}, 9)
  `
  await database.sql`
    INSERT INTO "D" ("id")
    VALUES (${eligibilityD1})
  `
  await database.sql`
    INSERT INTO "Item" ("id", "title", "ownerB.id", "ownerC.id")
    VALUES
      (${eligibilityItem1}, 'match', ${eligibilityB1}, ${null}),
      (${eligibilityItem2}, 'other', ${eligibilityB2}, ${null}),
      (${eligibilityItem3}, 'match', ${null}, ${eligibilityC1}),
      (${eligibilityItem4}, 'other', ${null}, ${eligibilityC2})
  `
  await database.sql`
    INSERT INTO "Document" ("id", "code")
    VALUES (${eligibilityPublicDoc}, 'pub'), (${eligibilityPrivateDoc}, 'priv'), (${eligibilityPrivateDocTwo}, 'priv2')
  `
  await database.sql`
    INSERT INTO "PublicDocument" ("id")
    VALUES (${eligibilityPublicDoc})
  `
  await database.sql`
    INSERT INTO "Workspace" ("id")
    VALUES (${eligibilityWorkspaceOne}), (${eligibilityWorkspaceTwo})
  `
  await database.sql`
    INSERT INTO "Member" ("id", "workspace.id")
    VALUES (${eligibilityMemberOne}, ${eligibilityWorkspaceOne})
  `
  await database.sql`
    INSERT INTO "Owner" ("id")
    VALUES (${eligibilityOwnerOne}), (${eligibilityOwnerTwo})
  `
  await database.sql`
    INSERT INTO "TeamMember" ("id", "owner.id")
    VALUES
      (${eligibilityAdminOne}, ${eligibilityOwnerOne}),
      (${eligibilityAdminTwo}, ${eligibilityOwnerOne}),
      (${eligibilityGuestOne}, ${eligibilityOwnerOne}),
      (${eligibilityGuestTwo}, ${eligibilityOwnerTwo})
  `
  await database.sql`
    INSERT INTO "AdminTeamMember" ("id", "scores")
    VALUES
      (${eligibilityAdminOne}, ARRAY [1, 2]::DOUBLE PRECISION[]),
      (${eligibilityAdminTwo}, ARRAY []::DOUBLE PRECISION[])
  `
  await database.sql`
    INSERT INTO "GuestTeamMember" ("id")
    VALUES (${eligibilityGuestOne}), (${eligibilityGuestTwo})
  `
  await database.sql`
    INSERT INTO "Ticket" ("id", "title", "admin.id")
    VALUES (${eligibilityTicketOne}, 'Urgent', ${eligibilityAdminOne})
  `
  await database.sql`
    INSERT INTO "PrivateDocument" ("id", "secret", "workspace.id")
    VALUES (${eligibilityPrivateDoc}, 's', ${eligibilityWorkspaceOne})
  `
  await database.sql`
    INSERT INTO "PrivateDocument" ("id", "secret", "workspace.id")
    VALUES (${eligibilityPrivateDocTwo}, 't', ${eligibilityWorkspaceTwo})
  `
  await database.sql`
    INSERT INTO "Section" ("id", "document.id")
    VALUES
      (${eligibilitySection1}, ${eligibilityPublicDoc}),
      (${eligibilitySection2}, ${eligibilityPrivateDoc}),
      (${eligibilitySection3}, ${eligibilityPrivateDocTwo})
  `
}

/**
 * Execute one native-array containment query under an explicit actor context.
 * @param database - Isolated PostgreSQL database.
 * @param actor - Actor identity, or null for anonymous.
 * @param entity - Entity being queried.
 * @param where - Source or structured filter.
 * @returns Matching row identities.
 */
async function executeAsActor(
  database: LifecycleDatabase,
  actor: string | null,
  entity: string,
  where: Filter | Readonly<Record<string, unknown>> | string,
): Promise<{ id: string }[]> {
  return database.tx(async sql => {
    await sql`
      SELECT SET_CONFIG('actor.id', ${actor ?? ''}, TRUE)
    `
    return queryEntity<{ id: string }>(sql, definitions, entity, {
      fields: ['id'],
      orderBy: 'id',
      where,
    })
  })
}

/**
 * Execute one parity case in both input forms.
 * @param database - Isolated PostgreSQL database.
 * @param queryCase - Source/structured case.
 * @returns Both result arrays.
 */
async function execute(
  database: LifecycleDatabase,
  queryCase: ParityCase,
): Promise<{ source: { id: string }[], structured: { id: string }[] }> {
  const options = queryCase.options ?? {}
  const shared = {
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
    source: 'pets.$total >= 2',
    structured: { field: 'pets.$total', operator: Operator.Comparison.GreaterThanOrEqual, value: 2 },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'pets.$total = 0',
    structured: { field: 'pets.$total', operator: Operator.Comparison.Equal, value: 0 },
  },
  {
    entity: 'Person',
    expected: [ada, grace],
    source: 'scores.$total > 0',
    structured: { field: 'scores.$total', operator: Operator.Comparison.GreaterThan, value: 0 },
  },
  {
    entity: 'Person',
    expected: [linus],
    source: 'scores.$total = 0',
    structured: { field: 'scores.$total', operator: Operator.Comparison.Equal, value: 0 },
  },
  {
    entity: 'Campaign',
    expected: [campaignOne],
    source: 'members.$total >= 3',
    structured: { field: 'members.$total', operator: Operator.Comparison.GreaterThanOrEqual, value: 3 },
  },
  {
    entity: 'Campaign',
    expected: [campaignThree],
    source: 'members.$total = 0',
    structured: { field: 'members.$total', operator: Operator.Comparison.Equal, value: 0 },
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
  {
    entity: 'Person',
    expected: [ada],
    source: "pets $contains (toys $contains (title = 'ball'))",
    structured: {
      field: 'pets',
      filters: [{
        field: 'toys',
        filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'ball' }],
        operator: Operator.Comparison.Contains,
      }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Pet',
    expected: [petThree],
    source: 'owner.pets $contains (age > 10)',
    structured: {
      field: 'owner.pets',
      filters: [{ field: 'age', operator: Operator.Comparison.GreaterThan, value: 10 }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: `pets $contains (id = '${petOne}' AND toys $contains (title = 'ball'))`,
    structured: {
      field: 'pets',
      filters: [{
        filters: [
          { field: 'id', operator: Operator.Comparison.Equal, value: petOne },
          {
            field: 'toys',
            filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'ball' }],
            operator: Operator.Comparison.Contains,
          },
        ],
        operator: Operator.Logical.And,
      }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [],
    source: `pets $contains (id = '${petTwo}' AND toys $contains (title = 'ball'))`,
    structured: {
      field: 'pets',
      filters: [{
        filters: [
          { field: 'id', operator: Operator.Comparison.Equal, value: petTwo },
          {
            field: 'toys',
            filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'ball' }],
            operator: Operator.Comparison.Contains,
          },
        ],
        operator: Operator.Logical.And,
      }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada, grace, linus],
    source: "campaigns $contains (members $contains (title = 'Grace'))",
    structured: {
      field: 'campaigns',
      filters: [{
        field: 'members',
        filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'Grace' }],
        operator: Operator.Comparison.Contains,
      }],
      operator: Operator.Comparison.Contains,
    },
  },
  {
    entity: 'Person',
    expected: [ada, grace, linus],
    source: "entity $in ['SystemUser', 'Client']",
    structured: {
      field: 'entity',
      operator: Operator.Comparison.In,
      value: ['SystemUser', 'Client'],
    },
  },
  {
    entity: 'Person',
    expected: [ada, linus],
    source: "entity $in ['SystemUser']",
    structured: {
      field: 'entity',
      operator: Operator.Comparison.In,
      value: ['SystemUser'],
    },
  },
  {
    entity: 'Person',
    expected: [],
    source: "entity $in ['Pet']",
    structured: {
      field: 'entity',
      operator: Operator.Comparison.In,
      value: ['Pet'],
    },
  },
  {
    entity: 'Person',
    expected: [ada, linus],
    source: "entity $in ['SystemUser', 'Pet']",
    structured: {
      field: 'entity',
      operator: Operator.Comparison.In,
      value: ['SystemUser', 'Pet'],
    },
  },
  {
    entity: 'Pet',
    expected: [petOne, petTwo],
    source: 'age $in [3, 8]',
    structured: {
      field: 'age',
      operator: Operator.Comparison.In,
      value: [3, 8],
    },
  },
  {
    entity: 'Pet',
    expected: [petOne, petTwo],
    source: 'vaccinated $in [true]',
    structured: {
      field: 'vaccinated',
      operator: Operator.Comparison.In,
      value: [true],
    },
  },
  {
    entity: 'Person',
    expected: [ada, grace],
    source: 'id $in favoriteIds',
    structured: {
      field: 'id',
      operator: Operator.Comparison.In,
      value: { $field: 'favoriteIds' },
    },
  },
  {
    entity: 'Person',
    expected: [],
    source: '$me $in favoriteIds',
    structured: {
      field: '$me',
      operator: Operator.Comparison.In,
      value: { $field: 'favoriteIds' },
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'primaryTag $in tags',
    structured: {
      field: 'primaryTag',
      operator: Operator.Comparison.In,
      value: { $field: 'tags' },
    },
  },
  {
    entity: 'Person',
    expected: [ada],
    source: 'tags $contains primaryTag',
    structured: {
      field: 'tags',
      operator: Operator.Comparison.Contains,
      value: { $field: 'primaryTag' },
    },
  },
]

describe('Query parity gate', () => {
  test('matches source and structured filters against real PostgreSQL', async () => {
    await withLifecycleDatabase('query-parity', async database => {
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
          fields: ['id', 'pets{$limit:1}'],
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
        readonly 'pets.$total': number,
        readonly 'scores.$total': number,
      }>(database.sql, definitions, 'Person', {
        fields: ['id', 'pets.$total', 'scores.$total'],
        orderBy: 'id',
      })
      expect(projected).toEqual([
        { 'id': ada, 'pets.$total': 2, 'scores.$total': 3 },
        { 'id': grace, 'pets.$total': 1, 'scores.$total': 1 },
        { 'id': linus, 'pets.$total': 0, 'scores.$total': 0 },
      ])

      const ordered = await queryEntity<{ id: string }>(database.sql, definitions, 'Person', {
        fields: ['id'],
        orderBy: 'pets.$total',
        where: 'pets.$total >= 0',
      })
      expect(ordered.map(row => row.id)).toEqual([linus, grace, ada])

      const actorCases = [
        { actor: ada, expected: [ada] },
        { actor: grace, expected: [ada, grace] },
        { actor: campaignOne, expected: [] },
        { actor: null, expected: [] },
      ] as const
      for (const actorCase of actorCases) {
        const inverseSource = await executeAsActor(
          database,
          actorCase.actor,
          'Person',
          '$me $in favoriteIds',
        )
        const inverseStructured = await executeAsActor(database, actorCase.actor, 'Person', {
          field: '$me',
          operator: Operator.Comparison.In,
          value: { $field: 'favoriteIds' },
        })
        const containsSource = await executeAsActor(
          database,
          actorCase.actor,
          'Person',
          'favoriteIds $contains $me',
        )
        const containsStructured = await executeAsActor(database, actorCase.actor, 'Person', {
          field: 'favoriteIds',
          operator: Operator.Comparison.Contains,
          value: '$me',
        })
        expect(inverseSource).toEqual(inverseStructured)
        expect(containsSource).toEqual(containsStructured)
        expect(inverseSource.map(row => row.id)).toEqual([...actorCase.expected])
        expect(containsSource.map(row => row.id)).toEqual([...actorCase.expected])
      }
    })
  })

  test('enforces descendant field and collection eligibility against PostgreSQL', async () => {
    await withLifecycleDatabase('polymorphic-eligibility', async database => {
      await seedEligibility(database)
      const ids = async (entity: string, where: string): Promise<string[]> => (
        (await queryEntity<{ id: string }>(database.sql, eligibilityDefinitions, entity, {
          fields: ['id'],
          limit: null,
          orderBy: 'id',
          where,
        })).map(row => row.id)
      )

      const eligibilityCases = [
        { entity: 'A', expected: [eligibilityB1, eligibilityC1], where: 'foo = 7' },
        { entity: 'A', expected: [eligibilityB2, eligibilityC2], where: 'foo = null' },
        {
          entity: 'A',
          expected: [eligibilityB2, eligibilityB3, eligibilityC2, eligibilityC3],
          where: 'NOT(foo = 7)',
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityC1, eligibilityD1],
          where: "foo = 7 OR label = 'd'",
        },
        { entity: 'A', expected: [eligibilityB1], where: "label = 'b7'" },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityC1],
          where: "items $contains (title = 'match')",
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityB3, eligibilityC1, eligibilityC3],
          where: "items $all (title = 'match')",
        },
        {
          entity: 'A',
          expected: [eligibilityB3, eligibilityC3],
          where: 'items $empty',
        },
        {
          entity: 'A',
          expected: [eligibilityB3, eligibilityC3],
          where: 'items.$total = 0',
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityB2, eligibilityC1, eligibilityC2],
          where: 'items.$total > 0',
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityC1],
          where: "items[title = 'match'].$matched >= 1",
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityB3],
          where: 'scores.$total > 0',
        },
        {
          entity: 'A',
          expected: [eligibilityB2],
          where: 'scores.$total = 0',
        },
        {
          entity: 'A',
          expected: [eligibilityB2],
          where: 'NOT(scores.$total > 0)',
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          where: "document.secret = 's'",
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          where: "NOT(document.secret = 's')",
        },
        {
          entity: 'Section',
          expected: [eligibilitySection1],
          where: "document.code = 'pub'",
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          where: `document.workspace.members $contains (id = '${eligibilityMemberOne}')`,
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          where: 'document.workspace.members $empty',
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          where: `NOT(document.workspace.members $contains (id = '${eligibilityMemberOne}'))`,
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          where: 'document.workspace.members.$total = 0',
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          where: 'document.workspace.members.$total > 0',
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          where: `document.workspace.members[id = '${eligibilityMemberOne}'].$matched >= 1`,
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          where: `document.workspace.members[id = '${eligibilityMemberOne}'].$matched = 0`,
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: "members $contains (tickets $contains (title = 'Urgent'))",
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: 'members $contains (tickets $empty)',
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: 'members $contains (scores.$total > 0)',
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: 'members $contains (tickets.$total > 0)',
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: "members $contains (tickets[title = 'Urgent'].$matched > 0)",
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerOne],
          where: "members $contains (tickets[title = 'Missing'].$matched = 0)",
        },
        {
          entity: 'Owner',
          expected: [eligibilityOwnerTwo],
          where: "NOT(members $contains (tickets $contains (title = 'Urgent')))",
        },
      ] as const
      for (const queryCase of eligibilityCases) {
        expect(await ids(queryCase.entity, queryCase.where)).toEqual([...queryCase.expected])
      }

      const parityCases = [
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityC1],
          source: 'foo = 7',
          structured: { field: 'foo', operator: Operator.Comparison.Equal, value: 7 },
        },
        {
          entity: 'A',
          expected: [eligibilityB2, eligibilityB3, eligibilityC2, eligibilityC3],
          source: 'NOT(foo = 7)',
          structured: {
            filters: [{ field: 'foo', operator: Operator.Comparison.Equal, value: 7 }],
            operator: Operator.Logical.Not,
          },
        },
        {
          entity: 'A',
          expected: [eligibilityB3, eligibilityC3],
          source: 'items $empty',
          structured: { field: 'items', operator: Operator.Comparison.Empty },
        },
        {
          entity: 'A',
          expected: [eligibilityB3, eligibilityC3],
          source: 'items.$total = 0',
          structured: { field: 'items.$total', operator: Operator.Comparison.Equal, value: 0 },
        },
        {
          entity: 'A',
          expected: [eligibilityB1, eligibilityB3],
          source: 'scores.$total > 0',
          structured: {
            field: 'scores.$total',
            operator: Operator.Comparison.GreaterThan,
            value: 0,
          },
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          source: "document.secret = 's'",
          structured: { 'document.secret': 's' },
        },
        {
          entity: 'Section',
          expected: [eligibilitySection2],
          source: `document.workspace.members $contains (id = '${eligibilityMemberOne}')`,
          structured: {
            field: 'document.workspace.members',
            filters: [{
              field: 'id',
              operator: Operator.Comparison.Equal,
              value: eligibilityMemberOne,
            }],
            operator: Operator.Comparison.Contains,
          },
        },
        {
          entity: 'Section',
          expected: [eligibilitySection3],
          source: 'document.workspace.members $empty',
          structured: {
            field: 'document.workspace.members',
            operator: Operator.Comparison.Empty,
          },
        },
      ] as const
      for (const queryCase of parityCases) {
        const sourceRows = await ids(queryCase.entity, queryCase.source)
        const structuredRows = await queryEntity<{ id: string }>(
          database.sql,
          eligibilityDefinitions,
          queryCase.entity,
          {
            fields: ['id'],
            limit: null,
            orderBy: 'id',
            where: queryCase.structured,
          },
        )
        expect(structuredRows.map(row => row.id)).toEqual(sourceRows)
        expect(sourceRows).toEqual([...queryCase.expected])
      }

      const nestedStructured = await queryEntity<{ id: string }>(
        database.sql,
        eligibilityDefinitions,
        'Owner',
        {
          fields: ['id'],
          limit: null,
          orderBy: 'id',
          where: {
            field: 'members',
            filters: [{
              field: 'tickets',
              filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'Urgent' }],
              operator: Operator.Comparison.Contains,
            }],
            operator: Operator.Comparison.Contains,
          },
        },
      )
      expect(nestedStructured.map(row => row.id)).toEqual([eligibilityOwnerOne])

      const matchedPath = `document.workspace.members[id = '${eligibilityMemberOne}'].$matched`
      const matchedStructured = await queryEntity<{ id: string }>(
        database.sql,
        eligibilityDefinitions,
        'Section',
        {
          fields: ['id'],
          limit: null,
          orderBy: 'id',
          where: { field: matchedPath, operator: Operator.Comparison.GreaterThanOrEqual, value: 1 },
        },
      )
      expect(matchedStructured.map(row => row.id)).toEqual([eligibilitySection2])

      await expect(queryEntity(database.sql, eligibilityDefinitions, 'A', {
        fields: ['id'],
        where: 'missing = 1',
      })).rejects.toThrow()
    })
  })

  test('scopes count caches to physical parent occurrences', async () => {
    await withLifecycleDatabase('count-parent-scope', async database => {
      const selfDefinitions = EntityDefinitions.load(JSON.stringify({
        entities: [{
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'manager', inverse: 'reports', target: 'Employee', type: 'Entity' },
            {
              cardinality: 'Many',
              field: 'reports',
              inverse: 'manager',
              target: 'Employee',
              type: 'Inverse',
            },
          ],
          name: 'Employee',
        }],
      }))
      await database.use(selfDefinitions)
      const root = '00000000-0000-4000-8000-000000000401'
      const report = '00000000-0000-4000-8000-000000000402'
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${root}, 'Root', 'Employee'), (${report}, 'Report', 'Employee')
      `
      await database.sql`
        INSERT INTO "Employee" ("id", "manager.id")
        VALUES (${root}, ${null}), (${report}, ${root})
      `
      const ids = async (where: Filter | string): Promise<string[]> => (
        (await queryEntity<{ id: string }>(database.sql, selfDefinitions, 'Employee', {
          fields: ['id'],
          limit: null,
          orderBy: 'id',
          where,
        })).map(row => row.id)
      )
      const nested = 'reports.$total > 0 AND reports $contains (reports.$total > 0)'
      expect(await ids(nested)).toEqual([])
      expect(await ids('reports $contains (reports.$total > 0) AND reports.$total > 0'))
        .toEqual([])
      expect(await ids({
        filters: [
          { field: 'reports.$total', operator: Operator.Comparison.GreaterThan, value: 0 },
          {
            field: 'reports',
            filters: [{
              field: 'reports.$total',
              operator: Operator.Comparison.GreaterThan,
              value: 0,
            }],
            operator: Operator.Comparison.Contains,
          },
        ],
        operator: Operator.Logical.And,
      })).toEqual([])
    })
  })

  test('preserves eligibility results when sibling declarations are reversed', async () => {
    await withLifecycleDatabase('polymorphic-eligibility-reversed', async database => {
      await seedEligibility(database, eligibilityDefinitionsReversed)
      const ids = async (where: string): Promise<string[]> => (
        (await queryEntity<{ id: string }>(database.sql, eligibilityDefinitionsReversed, 'A', {
          fields: ['id'],
          limit: null,
          orderBy: 'id',
          where,
        })).map(row => row.id)
      )
      expect(await ids('foo = 7')).toEqual([eligibilityB1, eligibilityC1])
      expect(await ids("items $contains (title = 'match')"))
        .toEqual([eligibilityB1, eligibilityC1])
      expect(await ids('items.$total = 0')).toEqual([eligibilityB3, eligibilityC3])
    })
  })
})
