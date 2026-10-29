import { describe, expect, test } from 'bun:test'
import { FieldType, Model } from './Model'

/**
 * Load a model value through its canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated model.
 */
function load(value: unknown): Model {
  return Model.load(JSON.stringify(value))
}

/** A valid minimal model with one entity and its primary key. */
const note = {
  entities: [{
    fields: [
      { name: 'id', primaryKey: true, type: 'id' },
      { name: 'title', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'createdAt', type: 'timestamp' },
    ],
    name: 'Note',
  }],
}

describe('Model', () => {
  test('loads one entity with an ID and scalar fields', () => {
    const model = load(note)
    const entity = model.entity('Note')

    expect(entity?.name).toBe('Note')
    expect(entity?.fields.map(field => field.name)).toEqual(['id', 'title', 'body', 'createdAt'])
    expect(entity?.fields.find(field => field.primaryKey)?.name).toBe('id')
  })

  test('exposes the canonical field types as an enum', () => {
    expect(String(FieldType.Boolean)).toBe('boolean')
    expect(String(FieldType.Date)).toBe('date')
    expect(String(FieldType.ID)).toBe('id')
    expect(String(FieldType.Number)).toBe('number')
    expect(String(FieldType.String)).toBe('string')
    expect(String(FieldType.Timestamp)).toBe('timestamp')
  })

  test('accepts every field type', () => {
    const model = load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'id' },
          { name: 'active', type: 'boolean' },
          { name: 'dueOn', type: 'date' },
          { name: 'score', type: 'number' },
          { name: 'title', type: 'string' },
          { name: 'createdAt', type: 'timestamp' },
        ],
        name: 'Note',
      }],
    })

    expect(model.entity('Note')?.fields.map(field => field.type)).toEqual([
      FieldType.ID,
      FieldType.Boolean,
      FieldType.Date,
      FieldType.Number,
      FieldType.String,
      FieldType.Timestamp,
    ])
  })

  test('requires the primary key to use the ID type', () => {
    expect(() => load({
      entities: [{
        fields: [{ name: 'id', primaryKey: true, type: 'string' }],
        name: 'Note',
      }],
    })).toThrow('primary key "Note.id" must be type id')
  })

  test('rejects malformed JSON', () => {
    expect(() => Model.load('{')).toThrow('Invalid model JSON')
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
          { name: 'id', primaryKey: true, type: 'id' },
          { name: 'title', type: 'string' },
          { name: 'title', type: 'string' },
        ],
        name: 'Note',
      }],
    })).toThrow('duplicate field "Note.title"')
  })

  test('rejects malformed names, unsupported types, and multiple primary keys', () => {
    expect(() => load({ entities: [{ fields: [{ name: 'id', primaryKey: true, type: 'id' }], name: 'note' }] }))
      .toThrow('entity name must be a PascalCase identifier')
    expect(() => load({ entities: [{ fields: [{ name: 'id', primaryKey: true, type: 'uuid' }], name: 'Note' }] }))
      .toThrow('unsupported field type "uuid"')
    expect(() => load({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'id' },
          { name: 'other', primaryKey: true, type: 'id' },
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
    expect(() => load({ entities: note.entities, futureThing: true })).toThrow('unknown model property "futureThing"')
    expect(() => load({
      entities: [{
        fields: [{ name: 'id', primaryKey: true, type: 'id', unique: true }],
        name: 'Note',
      }],
    })).toThrow('unknown field property "unique"')
  })
})
