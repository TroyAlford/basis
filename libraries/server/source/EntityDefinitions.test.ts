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
      ],
      name: 'User',
    },
    {
      extends: 'User',
      fields: [
        { field: 'permissions', type: 'String' },
        { column: 'managerId', field: 'manager', target: 'User', type: 'Entity' },
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

describe('EntityDefinitions', () => {
  test('exposes the canonical universal identity root metadata', () => {
    const root = identityDefinition()
    expect(root.name).toBe('Entity')
    expect(root.effectiveFields.map(field => field.name)).toEqual(['id', 'name', 'entity'])
    expect(root.effectiveFields.every(field => field.owner === 'Entity')).toBe(true)
  })

  test('uses the exact serialized field type vocabulary', () => {
    expect(Object.values(FieldType).map(String)).toEqual([
      'Boolean',
      'Collection',
      'Date',
      'Entity',
      'ID',
      'Number',
      'String',
      'Timestamp',
    ])
  })

  test('accepts typed generic collection fields and explicit storage', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          {
            field: 'tags',
            items: { type: 'String' },
            ordered: false,
            storage: 'jsonb',
            type: 'Collection',
          },
          {
            field: 'authors',
            items: { target: 'Entity', type: 'Entity' },
            ordered: true,
            storage: 'jsonb',
            type: 'Collection',
          },
          {
            field: 'payload',
            items: { type: 'Structured' },
            ordered: false,
            storage: 'jsonb',
            type: 'Collection',
          },
          {
            field: 'identities',
            items: { format: 'UUID', type: 'ID' },
            ordered: false,
            storage: 'jsonb',
            type: 'Collection',
          },
        ],
        name: 'CollectionRow',
      }],
    })
    expect(entities.entity('CollectionRow')?.fields[1]).toEqual({
      items: { type: FieldType.String },
      name: 'tags',
      ordered: false,
      storage: 'jsonb',
      type: FieldType.Collection,
    })
    expect(entities.entity('CollectionRow')?.effectiveFields.find(field => field.name === 'payload')).toMatchObject({
      items: { type: 'Structured' },
      owner: 'CollectionRow',
      type: FieldType.Collection,
    })
    expect(entities.ddl.join('\n')).toContain('"tags" jsonb not null')
    expect(entities.ddl.join('\n')).toContain('"authors" jsonb not null')
    expect(entities.ddl.join('\n')).toContain('"payload" jsonb not null')
  })

  test('rejects malformed generic collection fields', () => {
    const cases = [
      {
        fields: [{ field: 'tags', items: { type: 'String' }, ordered: false, type: 'Collection' }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'tags',
          items: { type: 'String' },
          ordered: 'no',
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'tags',
          items: { type: 'Missing' },
          ordered: false,
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'tags',
          items: { target: 'Missing', type: 'Entity' },
          ordered: false,
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'tags',
          items: { extra: true, type: 'Structured' },
          ordered: false,
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'tags',
          items: { format: 'UUID', type: 'String' },
          ordered: false,
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
      {
        fields: [{
          field: 'name',
          items: { type: 'String' },
          ordered: false,
          storage: 'jsonb',
          type: 'Collection',
        }],
        name: 'CollectionRow',
      },
    ]
    for (const entity of cases) expect(() => load({ entities: [entity] })).toThrow()
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
    ])
    expect(systemUser?.effectiveFields).toEqual([
      { format: 'UUID', name: 'id', owner: 'Entity', type: FieldType.ID },
      { name: 'name', owner: 'Entity', type: FieldType.String },
      { name: 'entity', owner: 'Entity', type: FieldType.String },
      { name: 'email', owner: 'User', type: FieldType.String },
      { name: 'permissions', owner: 'SystemUser', type: FieldType.String },
      {
        column: 'managerId',
        name: 'manager',
        owner: 'SystemUser',
        target: 'User',
        type: FieldType.Entity,
      },
    ])
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
      entities: [{ fields: [{ field: 'id', type: 'uuid' }], name: 'User' }],
    })).toThrow('unknown field property "type"')
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
          fields: [{ column: 'email', field: 'owner', target: 'User', type: 'Entity' }],
          name: 'SystemUser',
        },
      ],
    })).toThrow('physical column "email" is already owned by "User"')
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
        "managerId" text,
        constraint "SystemUser_id_format_check" check (${identityExpression('id', 'UUID')})
      )`,
      `create table "Client" (
        "id" text primary key,
        "company" text not null,
        constraint "Client_id_format_check" check (${identityExpression('id', 'UUID')})
      )`,
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
        foreign key ("managerId") references "User" ("id")
        deferrable initially immediate`,
      ...lifecycleDdl(['SystemUser', 'Client']),
    ])
  })

  test('allows references to the universal Entity root', () => {
    const entities = load({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { column: 'favoriteId', field: 'favorite', target: 'Entity', type: 'Entity' },
        ],
        name: 'Selection',
      }],
    })

    expect(entities.entity('Selection')?.fields[1]).toMatchObject({
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
      entities: [{ fields: [{ column: 'ownerId', field: 'owner', target: 'Missing', type: 'Entity' }], name: 'Note' }],
    })).toThrow('unknown target entity "Missing"')
    expect(() => load({
      entities: [{ fields: [{ field: 'owner', target: 'Note', type: 'Entity' }], name: 'Note' }],
    })).toThrow('column must be a camelCase identifier')
    expect(() => load({
      entities: [{ fields: [{ column: 'ownerId', field: 'owner', target: 'Note', type: 'Entity' }], name: 'Note' }],
    })).not.toThrow()
  })
})
