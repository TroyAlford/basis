import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { FieldType, Graph } from 'basis/server'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withIsolatedDatabase } from '../../server/testing/DatabaseIsolation'
import { generateJSONSchemas, generateTypes } from '../index'

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
          'lastUpdatedAt',
          'lastUpdatedBy',
          'nullableOwner',
          'nullableTags',
          'owner',
          'requiredJSON',
          'requiredOwner',
        ],
        limit: null,
        orderBy: 'name',
      })
      const schemas = generateJSONSchemas(graph)
      const validator = new Ajv2020({ allErrors: true })
      addFormats(validator)
      const validate = validator.compile({
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

  test('typechecks generated enum declarations and nullable enum fields', async () => {
    const enumGraph = new Graph({
      entities: [{
        fields: [
          { enum: 'AccessLevel', field: 'access', type: FieldType.Enum },
          {
            enum: 'AccessLevel',
            field: 'optional',
            nullable: true,
            type: FieldType.Enum,
          },
        ],
        name: 'EnumOutput',
      }],
      enums: {
        AccessLevel: {
          owner: 'Can manage this resource.',
          viewer: 'Can view this resource.',
        },
      },
    })
    const directory = await mkdtemp(join(tmpdir(), 'basis-enum-output-'))
    try {
      const file = join(directory, 'types.ts')
      const types = generateTypes(enumGraph)
      expect(types).toContain('export enum AccessLevel')
      expect(types).toContain('readonly optional: AccessLevel | null')
      await writeFile(file, types)
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          './node_modules/@typescript/native/bin/tsc',
          '--ignoreConfig',
          '--noEmit',
          '--skipLibCheck',
          '--strict',
          file,
        ],
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      })
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)
})
