import { describe, expect, test } from 'bun:test'
import { toMatchSQL } from '../testing/toMatchSQL'
import { EntityDefinitions, FieldType } from './EntityDefinitions'

expect.extend({ toMatchSQL })

/**
 * Load entity definitions through their canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated entity definitions.
 */
function load(value: unknown): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify(value))
}

/**
 * Build the universal identity root DDL included in every complete schema.
 * @param leaves - Concrete leaf entity names accepted by the root.
 * @returns Ordered identity-root SQL statements.
 */
function identityDdl(leaves: readonly string[]): readonly string[] {
  return [
    'create extension if not exists pg_trgm with schema public',
    `create table "Entity" (
      "id" text primary key,
      "displayName" text not null,
      "entity" text not null,
      constraint "Entity_id_format_check" check (
        case
          when "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
          when "id" ~ '^(0|-?[1-9][0-9]*)$' and length("id") <= 20
            then "id"::numeric between -9223372036854775808 and 9223372036854775807
          else false
        end
      ),
      constraint "Entity_entity_check" check ("entity" in (${leaves.map(name => `'${name}'`).join(', ')}))
    )`,
    `create index if not exists "Entity_displayName_id_idx"
      on "Entity" ("displayName", "id")`,
    `create index if not exists "Entity_displayName_trgm_idx"
      on "Entity" using gin ("displayName" public.gin_trgm_ops)`,
  ]
}

/** A valid minimal entity document with its primary key. */
const note = {
  entities: [{
    fields: [
      { name: 'id', primaryKey: true, type: 'uuid' },
      { name: 'title', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'createdAt', type: 'timestamp' },
    ],
    name: 'Note',
  }],
}

describe('EntityDefinitions', () => {
  test('loads one entity with a UUID and scalar fields', () => {
    const entities = load(note)
    const entity = entities.entity('Note')

    expect(entity?.name).toBe('Note')
    expect(entity?.fields.map(field => field.name)).toEqual(['id', 'title', 'body', 'createdAt'])
    expect(entity?.fields.find(field => field.type !== FieldType.Entity && field.primaryKey)?.name).toBe('id')
  })

  test('emits lowercase PostgreSQL keywords in generated DDL', () => {
    const entities = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { column: 'managerId', name: 'manager', target: 'User', type: 'entity' },
          { name: 'name', type: 'string' },
        ],
        name: 'User',
      }],
    })

    const keywords = [
      'ALTER', 'AND', 'ASC', 'BETWEEN', 'BIGINT', 'BOOLEAN', 'CASE', 'CHECK',
      'CONSTRAINT', 'CREATE', 'DATE', 'DEFERRABLE', 'DOUBLE', 'ELSE', 'END',
      'EXTENSION', 'FALSE', 'FOREIGN', 'GIN', 'IF', 'IMMEDIATE', 'INDEX',
      'INITIALLY', 'KEY', 'NOT', 'NULL', 'ON', 'PRECISION', 'PRIMARY', 'PUBLIC',
      'REFERENCES', 'SCHEMA', 'TABLE', 'TEXT', 'THEN', 'TIMESTAMPTZ', 'TRUE',
      'USING', 'UUID', 'WHEN', 'WITH',
    ]
    expect(entities.ddl.join('\n')).not.toMatch(new RegExp(`\\b(?:${keywords.join('|')})\\b`))
  })

  test('accepts every scalar field type', () => {
    const entities = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'active', type: 'boolean' },
          { name: 'dueOn', type: 'date' },
          { name: 'score', type: 'number' },
          { name: 'externalId', type: 'snowflake' },
          { name: 'title', type: 'string' },
          { name: 'createdAt', type: 'timestamp' },
        ],
        name: 'Note',
      }],
    })

    expect(entities.entity('Note')?.fields.map(field => field.type)).toEqual([
      FieldType.UUID,
      FieldType.Boolean,
      FieldType.Date,
      FieldType.Number,
      FieldType.Snowflake,
      FieldType.String,
      FieldType.Timestamp,
    ])
  })

  test('represents logical references as fields and derives physical FK columns', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'ownerId', name: 'owner', target: 'User', type: 'entity' },
            { column: 'lastUpdatedById', name: 'lastUpdatedBy', target: 'User', type: 'entity' },
            { name: 'title', type: 'string' },
          ],
          name: 'Note',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'snowflake' },
            { name: 'name', type: 'string' },
          ],
          name: 'User',
        },
      ],
    })

    expect(entities.entity('Note')?.fields.map(field => field.name))
      .toEqual(['id', 'owner', 'lastUpdatedBy', 'title'])
    expect(entities.entity('Note')?.fields).toContainEqual({
      column: 'ownerId',
      name: 'owner',
      target: 'User',
      targetField: 'id',
      targetType: FieldType.Snowflake,
      type: FieldType.Entity,
    })
    expect(entities.entity('Note')?.fields).toContainEqual({
      column: 'lastUpdatedById',
      name: 'lastUpdatedBy',
      target: 'User',
      targetField: 'id',
      targetType: FieldType.Snowflake,
      type: FieldType.Entity,
    })
    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['Note', 'User']),
      `create table "Note" (
        "id" text primary key,
        "ownerId" text not null,
        "lastUpdatedById" text not null,
        "title" text not null
      )`,
      `create table "User" (
        "id" text primary key,
        "name" text not null
      )`,
      `alter table "Note" add constraint "Note_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "Note" add constraint "Note_owner_fkey"
        foreign key ("ownerId") references "User" ("id")
        deferrable initially immediate`,
      `alter table "Note" add constraint "Note_lastUpdatedBy_fkey"
        foreign key ("lastUpdatedById") references "User" ("id")
        deferrable initially immediate`,
    ])
  })

  test('leaves undeclared relationship-looking scalars ordinary even when the target exists', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'userId', type: 'snowflake' },
          ],
          name: 'Note',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'snowflake' },
            { name: 'name', type: 'string' },
          ],
          name: 'User',
        },
      ],
    })

    expect(entities.entity('Note')?.fields).toEqual([
      { name: 'id', primaryKey: true, type: FieldType.UUID },
      { name: 'userId', primaryKey: false, type: FieldType.Snowflake },
    ])
    expect(entities.ddl.some(ddl => ddl.includes('references "User"'))).toBe(false)
  })

  test('accepts any explicit physical column name for a logical reference', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'writer', name: 'author', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })

    expect(entities.entity('Note')?.fields[1]).toEqual({
      column: 'writer',
      name: 'author',
      target: 'User',
      targetField: 'id',
      targetType: FieldType.Snowflake,
      type: FieldType.Entity,
    })
    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['Note', 'User']),
      `create table "Note" (
        "id" text primary key,
        "writer" text not null
      )`,
      'create table "User" ("id" text primary key)',
      `alter table "Note" add constraint "Note_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "Note" add constraint "Note_author_fkey"
        foreign key ("writer") references "User" ("id")
        deferrable initially immediate`,
    ])
  })

  test('derives the reference column type from a non-id target primary key', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'userId', name: 'user', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [
            { name: 'externalId', primaryKey: true, type: 'snowflake' },
            { name: 'name', type: 'string' },
          ],
          name: 'User',
        },
      ],
    })

    expect(entities.entity('Note')?.fields[1]).toMatchObject({
      targetField: 'externalId',
      targetType: FieldType.Snowflake,
    })
    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['Note', 'User']),
      `create table "Note" (
        "id" text primary key,
        "userId" text not null
      )`,
      `create table "User" (
        "externalId" text primary key,
        "name" text not null
      )`,
      `alter table "Note" add constraint "Note_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("externalId") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "Note" add constraint "Note_user_fkey"
        foreign key ("userId") references "User" ("externalId")
        deferrable initially immediate`,
    ])
  })

  test('supports self-referential singular references', () => {
    const entities = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { column: 'managerId', name: 'manager', target: 'User', type: 'entity' },
          { name: 'name', type: 'string' },
        ],
        name: 'User',
      }],
    })

    expect(entities.entity('User')?.fields[1]).toMatchObject({
      column: 'managerId',
      name: 'manager',
      target: 'User',
      targetField: 'id',
      type: FieldType.Entity,
    })
    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['User']),
      `create table "User" (
        "id" text primary key,
        "managerId" text not null,
        "name" text not null
      )`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_manager_fkey"
        foreign key ("managerId") references "User" ("id")
        deferrable initially immediate`,
    ])
  })

  test('rejects invalid references and physical column collisions', () => {
    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { column: 'ownerId', name: 'owner', target: 'Missing', type: 'entity' },
        ],
        name: 'Note',
      }],
    })).toThrow('unknown target entity "Missing" for field "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'owner', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('column must be a camelCase identifier')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'owner_id', name: 'owner', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('column must be a camelCase identifier')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'ownerId', name: 'owner', target: 'user', type: 'entity' },
          ],
          name: 'Note',
        },
      ],
    })).toThrow('target must be a PascalCase entity name')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'ownerId', name: 'Owner', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
      ],
    })).toThrow('field name must be a camelCase identifier')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'owner', type: 'string' },
            { column: 'ownerId', name: 'owner', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('duplicate field "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
            { column: 'ownerId', name: 'owner', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('physical column "ownerId" is declared by both "Note.ownerId" and "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'ownerId', name: 'owner', target: 'User', type: 'entity' },
            { column: 'ownerId', name: 'editor', target: 'User', type: 'entity' },
          ],
          name: 'Note',
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('physical column "ownerId" is declared by both "Note.owner" and "Note.editor"')
  })

  test('rejects reference fields used as primary keys and undeclared relationships arrays', () => {
    expect(() => load({
      entities: [{
        fields: [
          {
            column: 'ownerId',
            name: 'owner',
            primaryKey: true,
            target: 'User',
            type: 'entity',
          },
        ],
        name: 'Note',
      }],
    })).toThrow('unknown field property "primaryKey"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [{ field: 'ownerId', name: 'owner', target: 'User' }],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('unknown entity property "relationships"')
  })

  test('supports cyclic references with phased deferrable constraints', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'carId', name: 'car', target: 'Car', type: 'entity' },
          ],
          name: 'User',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'userId', name: 'user', target: 'User', type: 'entity' },
          ],
          name: 'Car',
        },
      ],
    })

    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['User', 'Car']),
      `create table "User" (
        "id" text primary key,
        "carId" text not null
      )`,
      `create table "Car" (
        "id" text primary key,
        "userId" text not null
      )`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "Car" add constraint "Car_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "User" add constraint "User_car_fkey"
        foreign key ("carId") references "Car" ("id")
        deferrable initially immediate`,
      `alter table "Car" add constraint "Car_user_fkey"
        foreign key ("userId") references "User" ("id")
        deferrable initially immediate`,
    ])
  })

  test('parses explicit multi-tier abstract ancestry', () => {
    const entities = load({
      entities: [
        {
          abstract: true,
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'email', type: 'string' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'permissions', type: 'string' },
          ],
          name: 'SystemUser',
        },
      ],
    })

    expect(entities.entity('User')).toMatchObject({ abstract: true, parent: 'Entity' })
    expect(entities.entity('SystemUser')).toMatchObject({ abstract: false, parent: 'User' })
    expect(entities.entity('SystemUser')?.fields.map(field => field.name))
      .toEqual(['id', 'permissions'])
  })

  test('rejects invalid MTI ancestry and competing field ownership', () => {
    expect(() => load({
      entities: [
        { abstract: true, fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { extends: 'Missing', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'SystemUser' },
      ],
    })).toThrow('unknown parent entity "Missing"')

    expect(() => load({
      entities: [
        { fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { extends: 'User', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'SystemUser' },
      ],
    })).toThrow('parent entity "User" must be abstract')

    expect(() => load({
      entities: [
        { abstract: true, fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { extends: 'User', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'SystemUser' },
        { extends: 'SystemUser', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'Client' },
      ],
    })).toThrow('parent entity "SystemUser" must be abstract')

    expect(() => load({
      entities: [
        { abstract: true, fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        {
          abstract: true,
          extends: 'User',
          fields: [{ name: 'id', primaryKey: true, type: 'uuid' }],
          name: 'SystemUser',
        },
        { extends: 'User', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'Client' },
      ],
    })).not.toThrow()

    expect(() => load({
      entities: [
        { abstract: true, extends: 'Client', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { abstract: true, extends: 'User', fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'Client' },
      ],
    })).toThrow('ancestry cycle')

    expect(() => load({
      entities: [
        { abstract: true, fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { extends: 'User', fields: [{ name: 'identity', primaryKey: true, type: 'uuid' }], name: 'SystemUser' },
      ],
    })).toThrow('primary key name must match parent entity "User"')

    expect(() => load({
      entities: [
        { abstract: true, fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'User' },
        { extends: 'User', fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }], name: 'SystemUser' },
      ],
    })).toThrow('primary key type must match parent entity "User"')

    expect(() => load({
      entities: [
        {
          abstract: true,
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'email', type: 'string' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'email', type: 'string' },
          ],
          name: 'SystemUser',
        },
      ],
    })).toThrow('field "SystemUser.email" is already owned by "User"')

    expect(() => load({
      entities: [
        {
          abstract: true,
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'email', type: 'string' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'email', name: 'owner', target: 'User', type: 'entity' },
          ],
          name: 'SystemUser',
        },
      ],
    })).toThrow('physical column "email" is already owned by "User"')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'entity', type: 'string' },
        ],
        name: 'User',
      }],
    })).toThrow('field "User.entity" is reserved for the universal identity root')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { column: 'displayName', name: 'label', target: 'User', type: 'entity' },
        ],
        name: 'User',
      }],
    })).toThrow('physical column "displayName" is reserved for the universal identity root')
  })

  test('composes multi-tier MTI tables with shared text keys and parent joins', () => {
    const entities = load({
      entities: [
        {
          abstract: true,
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'email', type: 'string' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'permissions', type: 'string' },
          ],
          name: 'SystemUser',
        },
        {
          abstract: true,
          fields: [
            { name: 'id', primaryKey: true, type: 'snowflake' },
            { name: 'title', type: 'string' },
          ],
          name: 'Book',
        },
        {
          extends: 'Book',
          fields: [
            { name: 'id', primaryKey: true, type: 'snowflake' },
            { name: 'genre', type: 'string' },
          ],
          name: 'Novel',
        },
      ],
    })

    expect(entities.ddl).toMatchSQL([
      ...identityDdl(['SystemUser', 'Novel']),
      `create table "User" (
        "id" text primary key,
        "email" text not null
      )`,
      `create table "SystemUser" (
        "id" text primary key,
        "permissions" text not null
      )`,
      `create table "Book" (
        "id" text primary key,
        "title" text not null
      )`,
      `create table "Novel" (
        "id" text primary key,
        "genre" text not null
      )`,
      `alter table "User" add constraint "User_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "SystemUser" add constraint "SystemUser_User_mti_fkey"
        foreign key ("id") references "User" ("id")
        deferrable initially immediate`,
      `alter table "Book" add constraint "Book_Entity_mti_fkey"
        foreign key ("id") references "Entity" ("id")
        deferrable initially immediate`,
      `alter table "Novel" add constraint "Novel_Book_mti_fkey"
        foreign key ("id") references "Book" ("id")
        deferrable initially immediate`,
    ])
  })

  test('accepts a UUID or snowflake primary key', () => {
    const uuid = load({
      entities: [{
        fields: [{ name: 'id', primaryKey: true, type: 'uuid' }],
        name: 'Note',
      }],
    })
    const snowflake = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'snowflake' },
          { name: 'name', type: 'string' },
        ],
        name: 'User',
      }],
    })

    expect(uuid.entity('Note')?.fields[0]?.type).toBe(FieldType.UUID)
    expect(snowflake.entity('User')?.fields[0]?.type).toBe(FieldType.Snowflake)
  })

  test('rejects a primary key with a non-identity type', () => {
    for (const type of ['boolean', 'date', 'number', 'string', 'timestamp']) {
      expect(() => load({
        entities: [{
          fields: [{ name: 'id', primaryKey: true, type }],
          name: 'Note',
        }],
      })).toThrow('primary key "Note.id" must be type uuid or snowflake')
    }
  })

  test('rejects malformed JSON', () => {
    expect(() => EntityDefinitions.load('{')).toThrow('Invalid entity JSON')
  })

  test('rejects a missing or empty entity list', () => {
    expect(() => load({})).toThrow('entities must be a non-empty array')
    expect(() => load({ entities: [] })).toThrow('entities must be a non-empty array')
  })

  test('rejects duplicate entity definitions', () => {
    expect(() => load({ entities: [note.entities[0], note.entities[0]] })).toThrow('duplicate entity "Note"')
  })

  test('rejects duplicate field definitions', () => {
    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'title', type: 'string' },
          { name: 'title', type: 'string' },
        ],
        name: 'Note',
      }],
    })).toThrow('duplicate field "Note.title"')
  })

  test('rejects malformed names, unsupported types, and multiple primary keys', () => {
    expect(() => load({ entities: [{ fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'note' }] }))
      .toThrow('entity name must be a PascalCase identifier')
    expect(() => load({ entities: [{ fields: [{ name: 'id', primaryKey: true, type: 'integer' }], name: 'Note' }] }))
      .toThrow('unsupported field type "integer"')
    expect(() => load({ entities: [{ fields: [{ name: 'id', primaryKey: true, type: 'id' }], name: 'Note' }] }))
      .toThrow('unsupported field type "id"')
    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'other', primaryKey: true, type: 'uuid' },
        ],
        name: 'Note',
      }],
    })).toThrow('exactly one primary key')
  })

  test('rejects definitions without a primary key', () => {
    expect(() => load({ entities: [{ fields: [{ name: 'title', type: 'string' }], name: 'Note' }] }))
      .toThrow('exactly one primary key')
  })

  test('reserves the Entity name for the universal identity root', () => {
    expect(() => load({
      entities: [{
        fields: [{ name: 'id', primaryKey: true, type: 'uuid' }],
        name: 'Entity',
      }],
    })).toThrow('entity name "Entity" is reserved for the universal identity root')
  })

  test('rejects unknown properties so typos cannot become schema vocabulary', () => {
    expect(() => load({ entities: note.entities, futureThing: true }))
      .toThrow('unknown top-level property "futureThing"')
    expect(() => load({
      entities: [{
        fields: [{ name: 'id', primaryKey: true, type: 'uuid', unique: true }],
        name: 'Note',
      }],
    })).toThrow('unknown field property "unique"')
  })
})
