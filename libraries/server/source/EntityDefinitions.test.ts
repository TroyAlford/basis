import { describe, expect, test } from 'bun:test'
import { EntityDefinitions, FieldType } from './EntityDefinitions'

/**
 * Load entity definitions through their canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated entity definitions.
 */
function load(value: unknown): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify(value))
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
    expect(entities.ddl[0]).toContain('CREATE TABLE "User"')
    expect(entities.ddl[1]).toContain('"ownerId" BIGINT NOT NULL REFERENCES "User" ("id")')
    expect(entities.ddl[1]).toContain('"lastUpdatedById" BIGINT NOT NULL REFERENCES "User" ("id")')
    expect(entities.ddl[1]).not.toContain('"owner" BIGINT')
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
    expect(entities.ddl.some(ddl => ddl.includes('REFERENCES'))).toBe(false)
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
    expect(entities.ddl[1]).toContain('"writer" BIGINT NOT NULL REFERENCES "User" ("id")')
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
    expect(entities.ddl[1]).toContain('REFERENCES "User" ("externalId")')
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
    expect(entities.ddl[0]).toContain('"managerId" UUID NOT NULL REFERENCES "User" ("id")')
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

  test('rejects circular foreign-key DDL', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'bId', name: 'b', target: 'B', type: 'entity' },
          ],
          name: 'A',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'aId', name: 'a', target: 'A', type: 'entity' },
          ],
          name: 'B',
        },
      ],
    })

    expect(() => entities.ddl).toThrow('circular relationship')
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
