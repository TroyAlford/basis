import { Cardinality, FieldType, Graph } from 'basis/server'
import type { SQL } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MutationError, mutationRunner } from '../../server/source/Mutation'
import { emitter, generateJSONSchemas, generateTypes, JsonSchemaEmitter, TypeScriptEmitter } from '../index'

/**
 * Validate one value against the JSON Schema keywords emitted by codegen.
 * @param schema - Generated JSON Schema fragment.
 * @param value - Candidate value.
 * @returns Whether the value satisfies the schema.
 */
function validates(schema: Record<string, unknown>, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(candidate => validates(candidate as Record<string, unknown>, value))
  }
  if (schema.const !== undefined && value !== schema.const) return false
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
  if (types.length > 0 && !types.some(type => matchesType(type as string, value))) return false
  if (schema.type === 'object') {
    if (!isPlainRecord(value)) return false
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const key of (schema.required ?? []) as readonly string[]) {
      if (!Object.hasOwn(value, key)) return false
    }
    for (const [key, entry] of Object.entries(value)) {
      const property = properties[key]
      if (!property) {
        if (schema.additionalProperties === false) return false
        continue
      }
      if (!validates(property, entry)) return false
    }
  }
  if (schema.type === 'number' && typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false
  }
  if (schema.type === 'string' && typeof value === 'string') {
    const length = [...value].length
    if (typeof schema.minLength === 'number' && length < schema.minLength) return false
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false
  }
  return true
}

/**
 * Whether one JSON Schema type matches a value.
 * @param type - JSON Schema type name.
 * @param value - Candidate value.
 * @returns Whether the type matches.
 */
function matchesType(type: string, value: unknown): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isPlainRecord(value)
  return typeof value === type
}

/**
 * Whether a value is a plain object.
 * @param value - Candidate value.
 * @returns Whether it is a non-array object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const document = {
  entities: [
    {
      fields: [
        { field: 'email', type: FieldType.String as const },
        {
          cardinality: Cardinality.Many,
          field: 'notes',
          inverse: 'owner',
          target: 'Note',
          type: FieldType.Inverse as const,
        },
      ],
      name: 'User',
    },
    {
      fields: [
        { field: 'title', type: FieldType.String as const },
        { field: 'owner', inverse: 'notes', target: 'User', type: FieldType.Entity as const },
        { field: 'tags', items: { type: FieldType.String as const }, type: FieldType.Array as const },
        { field: 'metadata', type: FieldType.JSON as const },
        { field: 'dueOn', type: FieldType.Date as const },
        { field: 'createdAt', type: FieldType.Timestamp as const },
        { field: 'subject', target: 'Entity', type: FieldType.Entity as const },
      ],
      name: 'Note',
    },
  ],
  relationships: [{
    between: [
      { field: 'user', inverse: 'teams', target: 'User' },
      { field: 'team', inverse: 'members', target: 'Note' },
    ],
    fields: [{ field: 'role', type: FieldType.String as const }],
    name: 'Membership',
  }],
} as const

describe('codegen', () => {
  test('generates deterministic types and schemas', () => {
    const graph = new Graph({ entities: document })
    const types = generateTypes(graph)
    const schemas = generateJSONSchemas(graph)
    expect(types).toContain('export interface Note extends Entity')
    expect(types).toContain('export type EntityRef')
    expect(types).toContain('export type NoteRef')
    expect(types).toContain('readonly owner: UserRef | null')
    expect(types).toContain('readonly subject: EntityRef | null')
    expect(types).not.toContain('Projection')
    expect(schemas.Note?.output).toBeDefined()
    expect((schemas.Note?.create as {
      properties: Record<string, { type?: unknown }>,
    }).properties.owner?.type).toEqual(['string', 'null'])
    expect((schemas.Note?.output as {
      properties: Record<string, { anyOf?: unknown }>,
    }).properties.owner?.anyOf).toBeDefined()
    expect((schemas.Note?.output as {
      properties: Record<string, { format?: string }>,
    }).properties.dueOn?.format).toBe('date')
    expect((schemas.Note?.output as {
      properties: Record<string, { format?: string }>,
    }).properties.createdAt?.format).toBe('date-time')
  })

  test('materializes independent TypeScript and JSON Schema emitters', async () => {
    const graph = new Graph({
      entities: [{
        fields: [{ field: 'title', type: FieldType.String }],
        name: 'EmitterNote',
      }],
    })
    const directory = await mkdtemp(join(tmpdir(), 'basis-emitters-'))
    try {
      expect(TypeScriptEmitter.extension).toBe('ts')
      expect(TypeScriptEmitter.folder).toBe('typescript')
      expect(JsonSchemaEmitter.extension).toBe('json')
      expect(JsonSchemaEmitter.folder).toBe('json-schema')
      await Promise.all([
        TypeScriptEmitter(graph, directory),
        JsonSchemaEmitter(graph, directory),
      ])
      const types = await Bun.file(join(directory, 'typescript', 'index.ts')).text()
      const schemas = JSON.parse(
        await Bun.file(join(directory, 'json-schema', 'schemas.json')).text(),
      ) as { EmitterNote?: { output?: unknown } }
      expect(types).toContain('export interface EmitterNote')
      expect(schemas.EmitterNote?.output).toBeDefined()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('rejects emitter destinations that escape the output root', async () => {
    expect(() => emitter({ extension: 'ts', folder: '../escape' }, () => []))
      .toThrow('Unsafe emitter folder')
    const directory = await mkdtemp(join(tmpdir(), 'basis-emitter-safe-'))
    try {
      const unsafe = emitter(
        { extension: 'ts', folder: 'typescript' },
        () => [{ content: 'nope', name: '../escape' }],
      )
      const graph = new Graph({ entities: [{ fields: [], name: 'SafeThing' }] })
      await expect(unsafe(graph, directory)).rejects.toThrow('Unsafe emitted file name')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('reflects canonical bounds, required fields, and generated fields', () => {
    const graph = new Graph({
      entities: [{
        fields: [
          { field: 'score', maximum: 10, minimum: 0, type: FieldType.Number },
          { field: 'title', maxLength: 20, minLength: 2, type: FieldType.String },
          { field: 'nickname', nullable: true, type: FieldType.String },
        ],
        name: 'Thing',
      }],
    })
    const schemas = generateJSONSchemas(graph)
    const create = schemas.Thing?.create as {
      additionalProperties?: boolean,
      properties: Record<string, {
        maxLength?: number,
        maximum?: number,
        minLength?: number,
        minimum?: number,
        readOnly?: boolean,
        type?: string,
      }>,
      required: string[],
    }
    expect(create.additionalProperties).toBe(false)
    expect(create.required).toEqual(['name', 'score', 'title'])
    expect(create.properties.id).toEqual({ type: 'string' })
    expect(create.properties.entity).toBeUndefined()
    expect(create.properties.score?.minimum).toBe(0)
    expect(create.properties.score?.maximum).toBe(10)
    expect(create.properties.title?.minLength).toBe(2)
    expect(create.properties.title?.maxLength).toBe(20)
    expect(create.properties.nickname?.readOnly).toBeUndefined()
  })

  test('keeps generated create/update schemas aligned with mutation validation', async () => {
    const graph = new Graph({
      entities: [{
        fields: [
          { field: 'score', maximum: 10, minimum: 0, type: FieldType.Number },
          { field: 'title', maxLength: 20, minLength: 2, type: FieldType.String },
          { field: 'nickname', nullable: true, type: FieldType.String },
        ],
        name: 'Thing',
      }],
    })
    const schemas = generateJSONSchemas(graph)
    const validateCreate = (value: unknown): boolean => (
      validates(schemas.Thing?.create as Record<string, unknown>, value)
    )
    const validateUpdate = (value: unknown): boolean => (
      validates(schemas.Thing?.update as Record<string, unknown>, value)
    )
    const sql = {
      async unsafe(): Promise<Record<string, unknown>[]> {
        return []
      },
    } as unknown as SQL
    const mutations = mutationRunner(graph.definitions, sql)
    const valid = { name: 'Valid', score: 5, title: 'Good' }
    expect(validateCreate(valid)).toBe(true)
    expect(await mutations.create('Thing', valid)).toEqual({ created: 1 })
    const validNull = { name: 'Null', nickname: null, score: 5, title: 'Good' }
    expect(validateCreate(validNull)).toBe(true)
    expect(await mutations.create('Thing', validNull)).toEqual({ created: 1 })
    const invalidCreate = [
      { name: 'Missing', score: 5 },
      { extra: true, name: 'Unknown', score: 5, title: 'Good' },
      { entity: 'Thing', name: 'Generated', score: 5, title: 'Good' },
      { lastUpdatedAt: '2020-01-01', name: 'Readonly', score: 5, title: 'Good' },
      { name: 'Bounds', score: 11, title: 'Good' },
    ]
    for (const payload of invalidCreate) {
      expect(validateCreate(payload)).toBe(false)
      const error = await mutations.create('Thing', payload).catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(MutationError)
    }
    const invalidUpdate = [
      { extra: true, name: 'Unknown', score: 5, title: 'Good' },
      { entity: 'Thing', name: 'Generated', score: 5, title: 'Good' },
      { id: '00000000-0000-4000-8000-000000000001', name: 'Identity', score: 5, title: 'Good' },
      { lastUpdatedAt: '2020-01-01', name: 'Readonly', score: 5, title: 'Good' },
      { name: 'Bounds', score: 11, title: 'Good' },
    ]
    for (const payload of invalidUpdate) {
      expect(validateUpdate(payload)).toBe(false)
      const error = await mutations.edit('Thing', 'id == 1', payload)
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(MutationError)
    }
  })

  test('uses concrete descendants for abstract reference output discriminators', () => {
    const abstract = new Graph({
      entities: [
        { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        {
          fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }],
          name: 'Note',
        },
      ],
    })
    const schemas = generateJSONSchemas(abstract)
    const note = schemas.Note?.output as {
      properties: Record<string, { anyOf?: { properties?: Record<string, unknown> }[] }>,
    }
    const owner = note.properties.owner?.anyOf?.[0]?.properties?.entity as {
      enum?: string[],
    } | undefined
    expect(owner?.enum).toContain('AdminUser')
    const user = schemas.User?.output as {
      properties: Record<string, { enum?: string[] }>,
    }
    expect(user.properties.entity.enum).toContain('AdminUser')
    const userCreate = schemas.User?.create as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userCreate.properties.entity).toBeUndefined()
    expect(userCreate.properties.name).toBeDefined()
    const userUpdate = schemas.User?.update as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userUpdate.properties.entity).toBeUndefined()
  })

  test('emits assignable abstract reference types', async () => {
    const abstract = new Graph({
      entities: [
        { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        {
          fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }],
          name: 'Note',
        },
      ],
    })
    const directory = await mkdtemp(join(tmpdir(), 'basis-abstract-types-'))
    try {
      const file = join(directory, 'types.ts')
      await writeFile(file, `
${generateTypes(abstract)}
const owner: Note['owner'] = { entity: 'AdminUser', id: '1', name: 'Admin' }
      `.trim())
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

  test('emits TypeScript that compiles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'basis-authored-types-'))
    try {
      const file = join(directory, 'types.ts')
      await writeFile(file, generateTypes(new Graph({ entities: document })))
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
