import { describe, expect, test } from 'bun:test'
import { toMatchSQL } from '../testing/toMatchSQL'
import { EntityDefinitions, FieldType, identityDefinition } from './EntityDefinitions'

expect.extend({ toMatchSQL })

/**
 * Load entity definitions through their canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated entity definitions.
 */
function load(value: unknown): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify(value))
}

/** Canonical UUID identity pattern. */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
/** Snowflake identity pattern. */
const SNOWFLAKE_PATTERN = '^(0|-?[1-9][0-9]*)$'

/**
 * Quote one identifier.
 * @param value - Identifier.
 * @returns Quoted identifier.
 */
function quote(value: string): string {
  return `"${value}"`
}

/**
 * Build the expected identity predicate.
 * @param column - Identity column.
 * @param format - Effective format.
 * @returns SQL predicate.
 */
function identityExpression(column: string, format?: 'Snowflake' | 'UUID'): string {
  const id = quote(column)
  const uuid = `${id} ~ '${UUID_PATTERN}'`
  const snowflake = `case
    when ${id} ~ '${SNOWFLAKE_PATTERN}' and length(${id}) <= 20
      then ${id}::numeric between -9223372036854775808 and 9223372036854775807
    else false
  end`
  if (format === 'UUID') return uuid
  if (format === 'Snowflake') return snowflake
  return `(${uuid} or ${snowflake})`
}

/**
 * Build expected root DDL.
 * @param leaves - Concrete leaf names.
 * @returns Ordered root statements.
 */
function rootDdl(leaves: readonly string[]): readonly string[] {
  return [
    'create extension if not exists pg_trgm with schema public',
    `create table "Entity" (
      "id" text primary key,
      "name" text not null,
      "entity" text not null,
      "lastUpdatedBy.id" text,
      "lastUpdatedAt" timestamptz,
      constraint "Entity_id_format_check" check (${identityExpression('id')}),
      constraint "Entity_entity_check" check ("entity" in (${leaves.map(name => `'${name}'`).join(', ')}))
    )`,
    'create index if not exists "Entity_name_id_idx" on "Entity" ("name", "id")',
    'create index if not exists "Entity_name_trgm_idx" on "Entity" using gin ("name" public.gin_trgm_ops)',
  ]
}

/**
 * Build expected lifecycle DDL.
 * @param leaves - Concrete leaf names.
 * @returns Lifecycle statements.
 */
function lifecycleDdl(leaves: readonly string[]): readonly string[] {
  const leafChecks = leaves.map(name => `when '${name}' then
        if not exists (select 1 from ${quote(name)} where "id" = root_id) then
          raise exception 'incomplete root row % for entity %', root_id, root_entity;
        end if;`)
  const rootBody = `
declare
  root_id text;
  root_entity text;
begin
  root_id := new."id";
  select "entity" into root_entity from "Entity" where "id" = root_id;
  if not found then
    return null;
  end if;
  case root_entity
    ${leafChecks.join('\n    ')}
    else
      raise exception 'unknown concrete entity %', root_entity;
  end case;
  return new;
end
`
  const leafBody = `
declare
  key text;
  root_entity text;
  leaf_present integer;
begin
  if tg_op = 'UPDATE'
    and to_jsonb(old)->>'id' is distinct from to_jsonb(new)->>'id' then
    raise exception 'leaf row identity is immutable';
  end if;
  if tg_op = 'DELETE' then
    key := to_jsonb(old)->>'id';
  else
    key := to_jsonb(new)->>'id';
  end if;
  execute format('select 1 from %I where "id" = $1', tg_table_name)
    into leaf_present using key;
  if leaf_present is not null then
    select "entity" into root_entity from "Entity" where "id" = key;
    if not found then
      raise exception 'leaf row % has no root row', key;
    end if;
    if root_entity is distinct from tg_table_name then
      raise exception 'leaf row % must match root entity %, found %',
        key, tg_table_name, root_entity;
    end if;
  elsif exists (
    select 1 from "Entity" where "id" = key and "entity" = tg_table_name
  ) then
    raise exception 'deleting leaf row % would leave an incomplete root row', key;
  end if;
  return null;
end
`
  const immutableBody = `
begin
  if new."entity" is distinct from old."entity" then
    raise exception 'leaf discriminator for root row % is immutable', old."id";
  end if;
  return new;
end
`
  return [
    `create or replace function "Entity_validate_leaf"() returns trigger language plpgsql as $$${rootBody}$$`,
    `create or replace function "Entity_validate_leaf_row"() returns trigger language plpgsql as $$${leafBody}$$`,
    `create or replace function "Entity_leaf_immutable"() returns trigger language plpgsql as $$${immutableBody}$$`,
    'create constraint trigger "Entity_leaf_check" after insert or update on "Entity" ' +
      'deferrable initially deferred for each row execute function "Entity_validate_leaf"()',
    ...leaves.map(name => (
      `create constraint trigger ${quote(`${name}_leaf_check`)} ` +
      `after insert or update or delete on ${quote(name)} ` +
      'deferrable initially deferred for each row execute function "Entity_validate_leaf_row"()'
    )),
    'create trigger "Entity_leaf_immutable" before update of "entity" on "Entity" ' +
      'for each row execute function "Entity_leaf_immutable"()',
  ]
}

/** The required canonical ontology fixture. */
const ontology = {
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'email', type: 'String' },
        {
          cardinality: 'Many',
          field: 'managedUsers',
          inverse: 'manager',
          target: 'SystemUser',
          type: 'Inverse',
        },
      ],
      name: 'User',
    },
    {
      extends: 'User',
      fields: [
        { field: 'permissions', type: 'String' },
        { field: 'manager', inverse: 'managedUsers', target: 'User', type: 'Entity' },
      ],
      name: 'SystemUser',
    },
    {
      extends: 'User',
      fields: [{ field: 'company', type: 'String' }],
      name: 'Client',
    },
  ],
}

/** The exact canonical relationship fixture from the accepted ontology. */
const relationshipOntology = {
  entities: [
    {
      fields: [{
        cardinality: 'Many',
        field: 'articles',
        inverse: 'author',
        target: 'Article',
        type: 'Inverse',
      }],
      name: 'User',
    },
    { fields: [], name: 'Campaign' },
    {
      fields: [
        { field: 'author', inverse: 'articles', target: 'User', type: 'Entity' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
        { field: 'payload', type: 'JSON' },
      ],
      name: 'Article',
    },
  ],
  relationships: [{
    between: [
      { field: 'user', inverse: 'campaigns', target: 'User' },
      { field: 'campaign', inverse: 'members', target: 'Campaign' },
    ],
    fields: [
      { field: 'role', type: 'String' },
      { field: 'favorites', type: 'String' },
    ],
    name: 'Membership',
  }],
}

describe('EntityDefinitions', () => {
  test('exposes the canonical universal identity root metadata', () => {
    const root = identityDefinition()
    expect(root.name).toBe('Entity')
    expect(root.collections).toEqual([])
    expect(root.effectiveFields.map(field => field.name))
      .toEqual(['id', 'name', 'entity', 'lastUpdatedBy', 'lastUpdatedAt'])
    expect(root.effectiveFields.every(field => field.owner === 'Entity')).toBe(true)
  })

  test('uses the exact serialized field type vocabulary', () => {
    expect(Object.values(FieldType).map(String)).toEqual([
      'Array',
      'Boolean',
      'Date',
      'Entity',
      'ID',
      'Inverse',
      'JSON',
      'Number',
      'String',
      'Timestamp',
    ])
  })

  test('accepts the exact named-relationship ontology and derives both directions', () => {
    const entities = load(relationshipOntology)
    const user = entities.entity('User')
    const campaign = entities.entity('Campaign')
    const article = entities.entity('Article')

    expect(user?.collections.map(collection => collection.name)).toEqual(['articles', 'campaigns'])
    expect(campaign?.collections.map(collection => collection.name)).toEqual(['members'])
    expect(article?.collections).toEqual([])
    expect(article?.fields).toContainEqual({
      column: 'author.id',
      inverse: 'articles',
      name: 'author',
      target: 'User',
      type: FieldType.Entity,
    })
    expect(article?.fields).toContainEqual({
      items: { type: FieldType.String },
      name: 'tags',
      type: FieldType.Array,
    })
    expect(article?.fields).toContainEqual({ name: 'payload', type: FieldType.JSON })
    expect(entities.relationships).toHaveLength(1)
    expect(entities.relationship('Membership')).toMatchObject({
      between: [
        { field: 'user', inverse: 'campaigns', target: 'User' },
        { field: 'campaign', inverse: 'members', target: 'Campaign' },
      ],
      name: 'Membership',
    })

    const ddl = entities.ddl.join('\n')
    expect(ddl).toContain('create table "Membership"')
    expect(ddl).toContain('"user.id" text not null')
    expect(ddl).toContain('"campaign.id" text not null')
    expect(ddl).toContain('"role" text not null')
    expect(ddl).toContain('"favorites" text not null')
    expect(ddl).toContain('primary key ("user.id", "campaign.id")')
    expect(ddl).toContain('foreign key ("user.id") references "User" ("id")')
    expect(ddl).toContain('foreign key ("campaign.id") references "Campaign" ("id")')
    expect(ddl).toContain('create index if not exists "Membership_user_idx" on "Membership" ("user.id")')
    expect(ddl).toContain('create index if not exists "Membership_campaign_idx" on "Membership" ("campaign.id")')
    expect(ddl).toContain('"author.id" text')
    expect(ddl).toContain('create index if not exists "Article_author_fk_idx" on "Article" ("author.id")')
  })

  test('rejects the removed value-collection, structured and junction grammar', () => {
    const cases = [
      {
        entities: [{
          fields: [{
            field: 'labels',
            items: { type: 'String' },
            ordered: true,
            storage: 'jsonb',
            type: 'ValueCollection',
            unique: false,
          }],
          name: 'Document',
        }],
      },
      {
        entities: [{
          fields: [{
            field: 'events',
            items: {
              fields: [{ field: 'kind', type: 'String' }],
              type: 'Structured',
            },
            ordered: false,
            storage: 'jsonb',
            type: 'ValueCollection',
            unique: true,
          }],
          name: 'Document',
        }],
      },
      {
        entities: [{
          fields: [{ field: 'tags', items: { type: 'Structured' }, type: 'Array' }],
          name: 'Document',
        }],
      },
      {
        entities: [{
          fields: [{
            field: 'members',
            items: { target: 'User', type: 'Entity' },
            mapping: { field: 'owner', kind: 'Inverse' },
            type: 'Collection',
          }],
          name: 'Group',
        }],
      },
      {
        entities: [{
          fields: [{ column: 'ownerId', field: 'owner', target: 'User', type: 'Entity' }],
          name: 'Note',
        }],
      },
      {
        entities: [],
        relationships: [{
          between: [],
          fields: [],
          name: 'Membership',
          type: 'ManyToMany',
        }],
      },
    ]
    for (const value of cases) expect(() => load(value)).toThrow()
  })

  test('rejects invalid relationship endpoints, names, fields and alias collisions', () => {
    const base = {
      entities: [
        { fields: [], name: 'User' },
        { fields: [], name: 'Campaign' },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [],
        name: 'Membership',
      }],
    }
    expect(() => load(base)).not.toThrow()
    expect(() => load({
      ...base,
      relationships: [{ ...base.relationships[0], name: 'User' }],
    })).toThrow('conflicts with an entity name')
    expect(() => load({
      ...base,
      relationships: [base.relationships[0], base.relationships[0]],
    })).toThrow('duplicate relationship')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        between: [
          { field: 'user', inverse: 'campaigns', target: 'Missing' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
      }],
    })).toThrow('unknown target entity "Missing"')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'user', inverse: 'members', target: 'Campaign' },
        ],
      }],
    })).toThrow('endpoint fields must differ')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'campaigns', target: 'Campaign' },
        ],
      }],
    })).toThrow('endpoint inverse names must differ')
    expect(() => load({
      ...base,
      entities: [{ fields: [{ field: 'campaigns', type: 'String' }], name: 'User' }, base.entities[1]],
    })).toThrow('conflicts with a field')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
      }],
    })).toThrow('must be a scalar, array or JSON field')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        fields: [{ field: 'id', format: 'UUID' }],
      }],
    })).toThrow('may not declare an id refinement')
    expect(() => load({
      ...base,
      relationships: [{ ...base.relationships[0], name: `${'A'.repeat(64)}` }],
    })).toThrow('63-byte identifier limit')
    expect(() => load({
      ...base,
      relationships: [{
        ...base.relationships[0],
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'user', inverse: 'members', target: 'User' },
        ],
      }],
    })).toThrow('endpoint fields must differ')
    expect(() => load({
      ...base,
      entities: [
        {
          fields: [
            { field: 'a', inverse: 'campaigns', target: 'User', type: 'Entity' },
            { field: 'b', inverse: 'campaigns', target: 'User', type: 'Entity' },
          ],
          name: 'User',
        },
        base.entities[1],
      ],
    })).toThrow()
  })

  test('validates reciprocal Inverse declarations and 1:1 uniqueness', () => {
    const many = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { cardinality: 'Many', field: 'pets', inverse: 'owner', target: 'Pet', type: 'Inverse' },
          ],
          name: 'Person',
        },
      ],
    })
    expect(many.entity('Person')?.fields).toContainEqual({
      cardinality: 'Many',
      inverse: 'owner',
      name: 'pets',
      target: 'Pet',
      type: FieldType.Inverse,
    })
    expect(many.entity('Person')?.collections).toMatchObject([{
      association: { cardinality: 'Many' },
      kind: 'inverse',
      name: 'pets',
      target: 'Pet',
    }])
    expect(many.entity('Person')?.singularNavigations).toEqual([])
    expect(many.entity('Pet')?.effectiveFields.map(field => field.name)).not.toContain('pets')
    expect(many.ddl.join('\n')).toContain('Pet_owner_fk_idx')
    expect(many.ddl.join('\n')).not.toContain('create unique index')

    const one = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { cardinality: 'One', field: 'pet', inverse: 'owner', target: 'Pet', type: 'Inverse' },
          ],
          name: 'Person',
        },
      ],
    })
    expect(one.entity('Person')?.collections).toEqual([])
    expect(one.entity('Person')?.singularNavigations).toMatchObject([{
      association: { cardinality: 'One' },
      kind: 'inverse-one',
      name: 'pet',
      target: 'Pet',
    }])
    expect(one.ddl.join('\n')).toContain('create unique index if not exists "Pet_owner_fk_idx"')

    expect(() => load({
      entities: [
        { fields: [{ field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' }], name: 'Pet' },
        { fields: [], name: 'Person' },
      ],
    })).toThrow('no reciprocal Inverse field')
    expect(() => load({
      entities: [
        { fields: [{ field: 'owner', target: 'Person', type: 'Entity' }], name: 'Pet' },
        {
          fields: [{
            cardinality: 'Many',
            field: 'pets',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }],
          name: 'Person',
        },
      ],
    })).toThrow('do not name each other')
    expect(() => load({
      entities: [
        {
          fields: [
            { field: 'owner', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Person' },
        {
          extends: 'Person',
          fields: [{
            cardinality: 'One',
            field: 'pet',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }],
          name: 'SpecialPerson',
        },
      ],
    })).toThrow('must be declared on forward target')
    const inherited = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { cardinality: 'One', field: 'pet', inverse: 'owner', target: 'Pet', type: 'Inverse' },
          ],
          name: 'Person',
        },
        {
          extends: 'Person',
          fields: [],
          name: 'SpecialPerson',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    })
    expect(inherited.entity('SpecialPerson')?.singularNavigations.map(navigation => navigation.name))
      .toEqual(['pet'])
    expect(() => load({
      entities: [
        { fields: [{ field: 'owner', target: 'Person', type: 'Entity' }], name: 'Pet' },
        {
          fields: [{ field: 'pets', inverse: 'owner', target: 'Pet', type: 'Inverse' }],
          name: 'Person',
        },
      ],
    })).toThrow('cardinality must be One or Many')
    expect(() => load({
      entities: [
        {
          fields: [
            { field: 'owner', inverse: 'different', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        {
          fields: [{
            cardinality: 'Many',
            field: 'pets',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }],
          name: 'Person',
        },
      ],
    })).toThrow('do not name each other')
    expect(() => load({
      entities: [
        {
          fields: [
            { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        {
          fields: [{
            cardinality: 'Many',
            field: 'pets',
            inverse: 'owner',
            target: 'Campaign',
            type: 'Inverse',
          }],
          name: 'Person',
        },
        { fields: [], name: 'Campaign' },
      ],
    })).toThrow('requires one forward')
    expect(() => load({
      entities: [
        { fields: [{ field: 'owner', target: 'Person', type: 'Entity' }], name: 'Pet' },
        {
          fields: [{
            cardinality: 'Several',
            field: 'pets',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }],
          name: 'Person',
        },
      ],
    })).toThrow('cardinality must be One or Many')
  })

  test('supports abstract relationship targets and distinct self-relations', () => {
    const entities = load({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Person' },
        { extends: 'Person', fields: [], name: 'Member' },
      ],
      relationships: [{
        between: [
          { field: 'mentor', inverse: 'mentees', target: 'Person' },
          { field: 'member', inverse: 'mentors', target: 'Person' },
        ],
        fields: [{ field: 'since', type: 'Date' }],
        name: 'Mentorship',
      }],
    })
    expect(entities.entity('Person')?.collections.map(collection => collection.name))
      .toEqual(['mentees', 'mentors'])
    expect(entities.relationships[0]?.between.map(endpoint => endpoint.target))
      .toEqual(['Person', 'Person'])
    const ddl = entities.ddl.join('\n')
    expect(ddl).toContain('primary key ("mentor.id", "member.id")')
    expect(ddl).toContain('foreign key ("mentor.id") references "Person"')
    expect(ddl).toContain('foreign key ("member.id") references "Person"')
    expect(ddl).toContain('"since" date not null')
  })

  test('inherits derived navigations through ancestry and rejects field shadowing', () => {
    const model = {
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'articles',
              inverse: 'author',
              target: 'Article',
              type: 'Inverse',
            },
          ],
          name: 'User',
        },
        { extends: 'User', fields: [], name: 'SystemUser' },
        { fields: [], name: 'Campaign' },
        {
          fields: [{ field: 'author', inverse: 'articles', target: 'User', type: 'Entity' }],
          name: 'Article',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }
    const entities = load(model)
    expect(entities.entity('User')?.collections.map(collection => collection.name))
      .toEqual(['articles', 'campaigns'])
    expect(entities.entity('SystemUser')?.collections.map(collection => collection.name))
      .toEqual(['articles', 'campaigns'])

    expect(() => load({
      ...model,
      entities: model.entities.map(entity => (entity.name === 'SystemUser'
        ? { ...entity, fields: [{ field: 'campaigns', type: 'String' }] }
        : entity)),
    })).toThrow('conflicts with an inherited navigation')
  })

  test('emits nullable fields without NOT NULL while preserving defaults', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'retiredAt', nullable: true, type: 'Timestamp' },
          { field: 'createdAt', type: 'Timestamp' },
          { field: 'tags', items: { type: 'String' }, nullable: true, type: 'Array' },
          { field: 'payload', nullable: true, type: 'JSON' },
          { field: 'owner', nullable: false, target: 'User', type: 'Entity' },
        ],
        name: 'Account',
      }, {
        fields: [{ field: 'id', format: 'UUID' }],
        name: 'User',
      }],
    })
    const ddl = entities.ddl.join('\n')
    expect(ddl).toContain('"retiredAt" timestamptz')
    expect(ddl).not.toMatch(/"retiredAt" timestamptz not null/u)
    expect(ddl).toContain('"createdAt" timestamptz not null')
    expect(ddl).toContain('"tags" text[]')
    expect(ddl).not.toMatch(/"tags" text\[\] not null/u)
    expect(ddl).toContain('"payload" jsonb')
    expect(ddl).not.toMatch(/"payload" jsonb not null/u)
    expect(ddl).toContain('"owner.id" text not null')
  })

  test('rejects non-boolean nullable declarations', () => {
    expect(() => load({
      entities: [{
        fields: [{ field: 'retiredAt', nullable: 'yes', type: 'Timestamp' }],
        name: 'Account',
      }],
    })).toThrow('nullable must be a boolean')
  })

  test('emits declared defaults on field columns', () => {
    const entities = load({
      entities: [{
        fields: [
          { default: true, field: 'enabled', type: 'Boolean' },
          { default: 1.5, field: 'score', type: 'Number' },
          { default: "it's", field: 'label', type: 'String' },
          { default: '2020-01-01T00:00:00.000Z', field: 'createdAt', type: 'Timestamp' },
          { default: ['a', 'b'], field: 'tags', items: { type: 'String' }, type: 'Array' },
          { default: { active: true }, field: 'payload', type: 'JSON' },
        ],
        name: 'Thing',
      }],
    })
    const ddl = entities.ddl.join('\n')
    expect(ddl).toContain('"enabled" boolean not null default true')
    expect(ddl).toContain('"score" double precision not null default 1.5')
    expect(ddl).toContain('"label" text not null default \'it\'\'s\'')
    expect(ddl).toContain('"createdAt" timestamptz not null default \'2020-01-01T00:00:00.000Z\'::timestamptz')
    expect(ddl).toContain('"tags" text[] not null default ARRAY[\'a\', \'b\']')
    expect(ddl).toContain('"payload" jsonb not null default \'{"active":true}\'::jsonb')
  })

  test('rejects defaults that do not match the field type', () => {
    expect(() => load({
      entities: [{
        fields: [{ default: 'yes', field: 'enabled', type: 'Boolean' }],
        name: 'Thing',
      }],
    })).toThrow('default must be a valid Boolean value')
  })

  test('adds update tracking fields to every entity', () => {
    const entities = load({ entities: [{ fields: [], name: 'Note' }] })
    const note = entities.entity('Note')
    expect(note?.effectiveFields.slice(-2)).toMatchObject([
      {
        column: 'lastUpdatedBy.id',
        name: 'lastUpdatedBy',
        nullable: true,
        owner: 'Entity',
        target: 'User',
        type: FieldType.Entity,
      },
      { name: 'lastUpdatedAt', nullable: true, owner: 'Entity', type: FieldType.Timestamp },
    ])
    expect(entities.ddl.join('\n')).toContain('"lastUpdatedBy.id" text')
    expect(entities.ddl.join('\n')).toContain('"lastUpdatedAt" timestamptz')
  })

  test('normalizes field and named uniqueness constraints into unique indexes', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', type: 'String', unique: true },
          ],
          name: 'User',
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
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Campaign' },
      ],
    })
    expect(entities.entity('User')?.constraints).toMatchObject([{
      fields: ['email'],
      name: 'User email must be unique',
      type: 'Uniqueness',
    }])
    expect(entities.entity('Membership')?.constraints).toMatchObject([{
      description: 'Each user may only have one Membership per Campaign.',
      fields: ['userId', 'campaignId'],
      name: 'One Membership Per Campaign',
      type: 'Uniqueness',
    }])
    expect(entities.constraints).toHaveLength(2)
    const ddl = entities.ddl.join('\n')
    expect(ddl).toContain('create unique index if not exists "User_email_unique"')
    expect(ddl).toContain('create unique index if not exists "Membership_one_membership_per_campaign"')
    expect(ddl).toContain('("userId.id", "campaignId.id")')
  })

  test('normalizes named relationship uniqueness constraints', () => {
    const entities = load({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'User' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Campaign' },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        constraints: [{
          description: 'Each user may join a campaign once.',
          fields: ['user', 'campaign'],
          name: 'Unique Membership',
          type: 'Uniqueness',
        }],
        fields: [],
        name: 'Membership',
      }],
    })
    expect(entities.relationship('Membership')?.constraints).toMatchObject([{
      fields: ['user', 'campaign'],
      name: 'Unique Membership',
      type: 'Uniqueness',
    }])
    expect(entities.ddl.join('\n')).toContain(
      'create unique index if not exists "Membership_unique_membership" on "Membership" ("user.id", "campaign.id")',
    )
  })

  test('rejects invalid uniqueness declarations', () => {
    const model = (fields: unknown[], constraints?: unknown[]) => ({
      entities: [{
        ...(constraints === undefined ? {} : { constraints }),
        fields,
        name: 'Thing',
      }],
    })
    expect(() => load(model([{ field: 'title', type: 'String', unique: false }])))
      .toThrow('unique must be true')
    expect(() => load(model([{ field: 'title', type: 'String' }], [{
      description: 'One title',
      fields: ['missing'],
      name: 'Missing Field',
      type: 'Uniqueness',
    }]))).toThrow('unknown physical field "missing"')
    expect(() => load(model([{ field: 'title', type: 'String' }], [{
      description: 'Duplicate fields',
      fields: ['title', 'title'],
      name: 'Duplicate Fields',
      type: 'Uniqueness',
    }]))).toThrow('fields must be distinct')
    expect(() => load(model([{ field: 'title', type: 'String' }], [{
      description: 'Wrong type',
      fields: ['title'],
      name: 'Wrong Type',
      type: 'Other',
    }]))).toThrow('type must be Uniqueness')
  })

  test('accepts native scalar arrays and opaque JSON values', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'tags', items: { type: 'String' }, type: 'Array' },
          { field: 'identities', items: { format: 'UUID', type: 'ID' }, type: 'Array' },
          { field: 'payload', type: 'JSON' },
        ],
        name: 'Document',
      }],
    })
    expect(entities.entity('Document')?.fields[1]).toEqual({
      items: { type: FieldType.String },
      name: 'tags',
      type: FieldType.Array,
    })
    expect(entities.entity('Document')?.fields[2]).toEqual({
      items: { format: 'UUID', type: FieldType.ID },
      name: 'identities',
      type: FieldType.Array,
    })
    expect(entities.entity('Document')?.fields[3]).toEqual({ name: 'payload', type: FieldType.JSON })
    expect(entities.ddl.join('\n')).toContain('"tags" text[] not null')
    expect(entities.ddl.join('\n')).toContain('"payload" jsonb not null')
  })

  test('derives reciprocal navigations from explicit Inverse declarations', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'visits',
              inverse: 'pet',
              target: 'Visit',
              type: 'Inverse',
            },
          ],
          name: 'Pet',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'pet', inverse: 'visits', target: 'Pet', type: 'Entity' },
          ],
          name: 'Visit',
        },
        {
          extends: 'Visit',
          fields: [{ field: 'notes', type: 'String' }],
          name: 'SpecialVisit',
        },
      ],
    })
    expect(entities.entity('Pet')?.collections).toMatchObject([{
      kind: 'inverse',
      name: 'visits',
      target: 'Visit',
    }])
    expect(entities.entity('Pet')?.fields.map(field => field.name)).toContain('visits')
    expect(entities.entity('Pet')?.effectiveFields.map(field => field.name)).not.toContain('visits')
    expect(entities.ddl.join('\n')).not.toContain('"visits"')
    expect(entities.ddl.join('\n')).toContain('Visit_pet_fk_idx')
  })

  test('derives effective inheritance from the required ontology fixture', () => {
    const entities = load(ontology)
    const user = entities.entity('User')
    const systemUser = entities.entity('SystemUser')

    expect(user).toMatchObject({ abstract: true, idFormat: 'UUID', parent: 'Entity' })
    expect(systemUser).toMatchObject({ abstract: false, extends: 'User', idFormat: 'UUID', parent: 'User' })
    expect(user?.fields).toEqual([
      { format: 'UUID', name: 'id', type: FieldType.ID },
      { name: 'email', type: FieldType.String },
      {
        cardinality: 'Many',
        inverse: 'manager',
        name: 'managedUsers',
        target: 'SystemUser',
        type: FieldType.Inverse,
      },
    ])
    expect(systemUser?.effectiveFields).toEqual([
      { format: 'UUID', name: 'id', owner: 'Entity', type: FieldType.ID },
      { name: 'name', owner: 'Entity', type: FieldType.String },
      { name: 'entity', owner: 'Entity', type: FieldType.String },
      {
        column: 'lastUpdatedBy.id',
        name: 'lastUpdatedBy',
        nullable: true,
        owner: 'Entity',
        target: 'User',
        type: FieldType.Entity,
      },
      { name: 'lastUpdatedAt', nullable: true, owner: 'Entity', type: FieldType.Timestamp },
      { name: 'email', owner: 'User', type: FieldType.String },
      { name: 'permissions', owner: 'SystemUser', type: FieldType.String },
      {
        column: 'manager.id',
        inverse: 'managedUsers',
        name: 'manager',
        owner: 'SystemUser',
        target: 'User',
        type: FieldType.Entity,
      },
    ])
    expect(user?.collections).toMatchObject([{ kind: 'inverse', name: 'managedUsers', target: 'SystemUser' }])
    expect(systemUser?.inverseFields.map(field => field.name)).toContain('managedUsers')
  })

  test('accepts empty fields for a standalone concrete entity', () => {
    const entities = load({ entities: [{ fields: [], name: 'Note' }] })
    const note = entities.entity('Note')

    expect(note?.abstract).toBe(false)
    expect(note?.idFormat).toBeUndefined()
    expect(note?.fields).toEqual([{ name: 'id', type: FieldType.ID }])
  })

  test('accepts every scalar type and derives concrete leaves', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'active', type: 'Boolean' },
          { field: 'dueOn', type: 'Date' },
          { field: 'score', type: 'Number' },
          { field: 'title', type: 'String' },
          { field: 'createdAt', type: 'Timestamp' },
        ],
        name: 'Note',
      }],
    })

    expect(entities.entity('Note')?.fields.map(field => field.type)).toEqual([
      FieldType.ID,
      FieldType.Boolean,
      FieldType.Date,
      FieldType.Number,
      FieldType.String,
      FieldType.Timestamp,
    ])
  })

  test('rejects obsolete and malformed vocabulary', () => {
    expect(() => load({
      entities: [{ abstract: true, fields: [], name: 'User' }],
    })).toThrow('unknown entity property "abstract"')
    expect(() => load({
      entities: [{ fields: [{ name: 'id', type: 'uuid' }], name: 'User' }],
    })).toThrow('field name must be a camelCase identifier')
    expect(() => load({
      entities: [{ fields: [{ field: 'id', primaryKey: true, type: 'uuid' }], name: 'User' }],
    })).toThrow('unknown field property "primaryKey"')
    expect(() => load({
      entities: [{ fields: [{ field: 'externalId', format: 'UUID', type: 'ID' }], name: 'User' }],
    })).toThrow('unsupported field type "ID"')
    expect(() => load({
      entities: [{ fields: [{ field: 'id' }], name: 'User' }],
    })).toThrow('must specify format UUID or Snowflake')
    expect(() => load({
      entities: [{ fields: [{ field: 'name', type: 'String' }], name: 'User' }],
    })).toThrow('reserved for the universal identity root')
    expect(() => load({
      entities: [{ fields: [{ field: 'entity', type: 'String' }], name: 'User' }],
    })).toThrow('reserved for the universal identity root')
  })

  test('rejects invalid ancestry and competing ownership', () => {
    expect(() => load({
      entities: [
        { fields: [], name: 'User' },
        { extends: 'Missing', fields: [], name: 'SystemUser' },
      ],
    })).toThrow('unknown parent entity "Missing"')
    expect(() => load({
      entities: [
        { fields: [], name: 'User' },
        { extends: 'Entity', fields: [], name: 'SystemUser' },
      ],
    })).toThrow('extends "Entity" is implicit')
    expect(() => load({
      entities: [
        { extends: 'Client', fields: [], name: 'User' },
        { extends: 'User', fields: [], name: 'Client' },
      ],
    })).toThrow('ancestry cycle')
    expect(() => load({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [{ field: 'email', type: 'String' }], name: 'SystemUser' },
      ],
    })).toThrow('field "SystemUser.email" is already owned by "User"')
    expect(() => load({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        {
          extends: 'User',
          fields: [{ field: 'manager', target: 'User', type: 'Entity' }],
          name: 'SystemUser',
        },
      ],
    })).not.toThrow()
  })

  test('narrows but never conflicts with inherited id formats', () => {
    const narrowed = load({
      entities: [
        { fields: [], name: 'Node' },
        { extends: 'Node', fields: [{ field: 'id', format: 'UUID' }], name: 'Leaf' },
        { extends: 'Leaf', fields: [], name: 'Tip' },
      ],
    })
    expect(narrowed.entity('Leaf')?.idFormat).toBe('UUID')
    expect(narrowed.entity('Tip')?.idFormat).toBe('UUID')

    expect(() => load({
      entities: [
        { fields: [{ field: 'id', format: 'Snowflake' }], name: 'Node' },
        { extends: 'Node', fields: [{ field: 'id', format: 'UUID' }], name: 'Leaf' },
      ],
    })).toThrow('id format conflict')
  })

  test('composes physical DDL for the required ontology', () => {
    const entities = load(ontology)

    expect(entities.ddl).toMatchSQL([
      ...rootDdl(['SystemUser', 'Client']),
      `create table "User" (
        "id" text primary key,
        "email" text not null,
        constraint "User_id_format_check" check (${identityExpression('id', 'UUID')})
      )`,
      `create table "SystemUser" (
        "id" text primary key,
        "permissions" text not null,
        "manager.id" text,
        constraint "SystemUser_id_format_check" check (${identityExpression('id', 'UUID')})
      )`,
      'create index if not exists "SystemUser_manager_fk_idx" on "SystemUser" ("manager.id")',
      `create table "Client" (
        "id" text primary key,
        "company" text not null,
        constraint "Client_id_format_check" check (${identityExpression('id', 'UUID')})
      )`,
      `alter table "Entity" add constraint "Entity_lastUpdatedBy_fkey"
        foreign key ("lastUpdatedBy.id") references "User" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "SystemUser" add constraint "SystemUser_User_mti_fkey"
        foreign key ("id") references "User" ("id")
        deferrable initially immediate`,
      `alter table "Client" add constraint "Client_User_mti_fkey"
        foreign key ("id") references "User" ("id")
        deferrable initially immediate`,
      `alter table "SystemUser" add constraint "SystemUser_manager_fkey"
        foreign key ("manager.id") references "User" ("id")
        deferrable initially immediate`,
      ...lifecycleDdl(['SystemUser', 'Client']),
    ])
  })

  test('allows references to the universal Entity root', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'favorite', target: 'Entity', type: 'Entity' },
        ],
        name: 'Selection',
      }],
    })

    expect(entities.entity('Selection')?.fields[1]).toMatchObject({
      column: 'favorite.id',
      target: 'Entity',
      type: FieldType.Entity,
    })
    expect(entities.ddl.join('\n')).toContain(
      'references "Entity" ("id") deferrable initially immediate',
    )
  })

  test('emits lowercase SQL keywords', () => {
    const sql = load(ontology).ddl.join('\n').replaceAll("'UPDATE'", '')
    const keywords = [
      'ALTER', 'AND', 'CASE', 'CHECK', 'CONSTRAINT', 'CREATE', 'DEFERRABLE',
      'ELSE', 'END', 'FALSE', 'FOREIGN', 'GIN', 'IF', 'INDEX', 'INSERT', 'KEY',
      'NOT', 'NULL', 'ON', 'PRIMARY', 'REFERENCES', 'SELECT', 'TABLE', 'THEN',
      'TRUE', 'UNIQUE', 'UPDATE', 'USING', 'WHEN', 'WHERE',
    ]
    expect(sql).not.toMatch(new RegExp(`\\b(?:${keywords.join('|')})\\b`))
  })

  test('validates parsed and JSON documents through one entry point', () => {
    const document = {
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { fields: [], name: 'Note' },
      ],
    }
    const parsed = EntityDefinitions.fromDocument(document)
    const loaded = EntityDefinitions.load(JSON.stringify(document))
    expect(parsed.ddl).toEqual(loaded.ddl)
    expect(parsed.entities.map(entity => entity.name)).toEqual(loaded.entities.map(entity => entity.name))
  })

  test('exposes canonical ancestry and concrete descendant queries', () => {
    const definitions = load({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        { extends: 'User', fields: [], name: 'CustomerUser' },
        { fields: [], name: 'Note' },
      ],
    })
    expect(definitions.ancestry('AdminUser')).toEqual(['AdminUser', 'User', 'Entity'])
    expect(definitions.isA('AdminUser', 'User')).toBe(true)
    expect(definitions.isA('AdminUser', 'Entity')).toBe(true)
    expect(definitions.isA('User', 'AdminUser')).toBe(false)
    expect(definitions.concreteDescendants('User').map(entity => entity.name))
      .toEqual(['AdminUser', 'CustomerUser'])
    expect(definitions.concreteDescendants('Note').map(entity => entity.name)).toEqual(['Note'])
    expect(definitions.concreteDescendants('Entity').map(entity => entity.name))
      .toEqual(['AdminUser', 'CustomerUser', 'Note'])
    expect(() => definitions.ancestry('Missing')).toThrow('Unknown entity')
    expect(definitions.isA('Missing', 'Entity')).toBe(false)
    expect(() => definitions.concreteDescendants('Missing')).toThrow('Unknown entity')
  })

  test('rejects malformed entity documents and references', () => {
    expect(() => EntityDefinitions.load('{')).toThrow('Invalid entity JSON')
    expect(() => load({})).toThrow('entities must be a non-empty array')
    expect(() => load({ entities: [] })).toThrow('entities must be a non-empty array')
    expect(() => load({
      entities: [{ fields: [], name: 'note' }],
    })).toThrow('PascalCase')
    expect(() => load({
      entities: [{ fields: [], name: 'Entity' }],
    })).toThrow('reserved for the universal identity root')
    expect(() => load({
      entities: [{ fields: [{ field: 'owner', target: 'Missing', type: 'Entity' }], name: 'Note' }],
    })).toThrow('unknown target entity "Missing"')
    expect(() => load({
      entities: [{ fields: [{ field: 'owner', target: 'Note', type: 'Entity' }], name: 'Note' }],
    })).not.toThrow()
  })
})
