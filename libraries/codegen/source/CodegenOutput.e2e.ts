import Ajv from 'ajv'
import { FieldType, Graph } from 'basis/server'
import { describe, expect, test } from 'bun:test'
import { withIsolatedDatabase } from '../../server/testing/DatabaseIsolation'
import { generateJSONSchemas } from '../index'

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
    {
      fields: [
        { field: 'nullableJSON', nullable: true, type: FieldType.JSON },
        { field: 'nullableNote', nullable: true, type: FieldType.String },
        { field: 'nullableOwner', target: 'User', type: FieldType.Entity },
        { field: 'nullableTags', items: { type: FieldType.String }, nullable: true, type: FieldType.Array },
        { field: 'owner', target: 'User', type: FieldType.Entity },
        { field: 'requiredJSON', type: FieldType.JSON },
        { field: 'requiredOwner', nullable: false, target: 'User', type: FieldType.Entity },
        { field: 'title', type: FieldType.String },
      ],
      name: 'OutputRow',
    },
  ],
})

describe('Codegen output contracts', () => {
  test('match hydrated nullable and non-nullable PostgreSQL values', async () => {
    await withIsolatedDatabase('codegen-output-contract', async database => {
      await database.use(graph.definitions)
      await database.create('User', { email: 'owner@example.com', name: 'Owner' })
      const [owner] = await database.query<{ id: string }>('User', { fields: ['id'] })
      if (!owner) throw new Error('Owner was not created')
      await database.create('OutputRow', [
        {
          name: 'Nulls',
          nullableJSON: null,
          nullableNote: null,
          nullableOwner: null,
          nullableTags: null,
          owner: null,
          requiredJSON: { active: true },
          requiredOwner: owner.id,
          title: 'Nulls',
        },
        {
          name: 'Values',
          nullableJSON: { active: false },
          nullableNote: 'Note',
          nullableOwner: owner.id,
          nullableTags: ['a', 'b'],
          owner: owner.id,
          requiredJSON: {},
          requiredOwner: owner.id,
          title: 'Values',
        },
      ])
      const rows = await database.query<Record<string, unknown>>('OutputRow', {
        fields: [
          'id',
          'name',
          'entity',
          'title',
          'nullableJSON',
          'nullableNote',
          'nullableOwner.email',
          'nullableTags',
          'owner.email',
          'requiredJSON',
          'requiredOwner.email',
        ],
        limit: null,
        orderBy: 'name',
      })
      const schemas = generateJSONSchemas(graph)
      const validate = new Ajv({ allErrors: true }).compile({
        $defs: schemas.$defs,
        $ref: '#/$defs/OutputRow',
        $schema: schemas.$schema,
      })
      expect(rows).toHaveLength(2)
      expect(rows[0]?.nullableJSON).toBeNull()
      expect(rows[0]?.nullableTags).toBeNull()
      expect(rows[0]?.owner).toBeNull()
      for (const row of rows) expect(validate(row)).toBe(true)
      expect(validate({ ...rows[0], requiredJSON: null })).toBe(false)
      expect(validate({ ...rows[0], requiredOwner: null })).toBe(false)
    })
  }, 120_000)
})
