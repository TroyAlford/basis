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
    expect(entity?.fields.find(field => field.primaryKey)?.name).toBe('id')
  })

  test('accepts every field type', () => {
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

  test('resolves explicitly declared many-to-one relationships and orders FK DDL', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
            { name: 'lastUpdatedById', type: 'snowflake' },
            { name: 'title', type: 'string' },
          ],
          name: 'Note',
          relationships: [
            { field: 'ownerId', name: 'owner', target: 'User' },
            { field: 'lastUpdatedById', name: 'lastUpdatedBy', target: 'User' },
          ],
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

    expect(entities.entity('Note')?.relationships).toEqual([
      { field: 'ownerId', name: 'owner', targetEntity: 'User', targetField: 'id' },
      { field: 'lastUpdatedById', name: 'lastUpdatedBy', targetEntity: 'User', targetField: 'id' },
    ])
    expect(entities.ddl[0]).toContain('CREATE TABLE "User"')
    expect(entities.ddl[1]).toContain('"ownerId" BIGINT NOT NULL REFERENCES "User" ("id")')
    expect(entities.ddl[1]).toContain('"lastUpdatedById" BIGINT NOT NULL REFERENCES "User" ("id")')
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

    expect(entities.entity('Note')?.relationships).toEqual([])
    expect(entities.ddl.some(ddl => ddl.includes('REFERENCES'))).toBe(false)
  })

  test('accepts declared foreign-key fields without an Id suffix', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'writer', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [{ field: 'writer', name: 'author', target: 'User' }],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })

    expect(entities.entity('Note')?.relationships).toEqual([{
      field: 'writer',
      name: 'author',
      targetEntity: 'User',
      targetField: 'id',
    }])
    expect(entities.ddl[1]).toContain('"writer" BIGINT NOT NULL REFERENCES "User" ("id")')
  })

  test('references the target primary key even when it is not named id', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'userId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [{ field: 'userId', name: 'user', target: 'User' }],
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

    expect(entities.entity('Note')?.relationships).toEqual([{
      field: 'userId',
      name: 'user',
      targetEntity: 'User',
      targetField: 'externalId',
    }])
    expect(entities.ddl[1]).toContain('REFERENCES "User" ("externalId")')
  })

  test('supports self-referential many-to-one relationships', () => {
    const entities = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'managerId', type: 'uuid' },
          { name: 'name', type: 'string' },
        ],
        name: 'User',
        relationships: [{ field: 'managerId', name: 'manager', target: 'User' }],
      }],
    })

    expect(entities.entity('User')?.relationships).toEqual([{
      field: 'managerId',
      name: 'manager',
      targetEntity: 'User',
      targetField: 'id',
    }])
    expect(entities.ddl[0]).toContain('"managerId" UUID NOT NULL REFERENCES "User" ("id")')
  })

  test('rejects invalid relationship bindings', () => {
    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [{ field: 'missing', name: 'owner', target: 'User' }],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('unknown local field "Note.missing" for relationship "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [{ field: 'id', name: 'owner', target: 'User' }],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('relationship field "Note.id" cannot be a primary key')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'ownerId', type: 'snowflake' },
        ],
        name: 'Note',
        relationships: [{ field: 'ownerId', name: 'owner', target: 'Missing' }],
      }],
    })).toThrow('unknown target entity "Missing" for relationship "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'uuid' },
          ],
          name: 'Note',
          relationships: [{ field: 'ownerId', name: 'owner', target: 'User' }],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('relationship field "Note.ownerId" type uuid must match primary key "User.id" type snowflake')
  })

  test('rejects relationship namespace collisions and duplicate bindings', () => {
    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
            { name: 'editorId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [
            { field: 'ownerId', name: 'owner', target: 'User' },
            { field: 'editorId', name: 'owner', target: 'User' },
          ],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('duplicate relationship "Note.owner"')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'owner', type: 'string' },
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
    })).toThrow('relationship "Note.owner" collides with a scalar field')

    expect(() => load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'ownerId', type: 'snowflake' },
          ],
          name: 'Note',
          relationships: [
            { field: 'ownerId', name: 'owner', target: 'User' },
            { field: 'ownerId', name: 'editor', target: 'User' },
          ],
        },
        {
          fields: [{ name: 'id', primaryKey: true, type: 'snowflake' }],
          name: 'User',
        },
      ],
    })).toThrow('relationship field "Note.ownerId" is bound more than once')
  })

  test('rejects malformed relationship declarations', () => {
    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'ownerId', type: 'snowflake' },
        ],
        name: 'Note',
        relationships: [{ field: 'ownerId', name: 'Owner', target: 'User' }],
      }],
    })).toThrow('relationship name must be a camelCase identifier')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'ownerId', type: 'snowflake' },
        ],
        name: 'Note',
        relationships: [{ field: 'ownerId', name: 'owner', target: 'user' }],
      }],
    })).toThrow('target must be a PascalCase entity name')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'ownerId', references: 'User', type: 'snowflake' },
        ],
        name: 'Note',
      }],
    })).toThrow('unknown field property "references"')

    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { name: 'ownerId', type: 'snowflake' },
        ],
        name: 'Note',
        relationships: { field: 'ownerId', name: 'owner', target: 'User' },
      }],
    })).toThrow('relationships must be an array')
  })

  test('rejects circular foreign-key DDL', () => {
    const entities = load({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'bId', type: 'uuid' },
          ],
          name: 'A',
          relationships: [{ field: 'bId', name: 'b', target: 'B' }],
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { name: 'aId', type: 'uuid' },
          ],
          name: 'B',
          relationships: [{ field: 'aId', name: 'a', target: 'A' }],
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
