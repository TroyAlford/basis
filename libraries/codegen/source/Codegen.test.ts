import Ajv from 'ajv'
import { Cardinality, FieldType, Graph } from 'basis/server'
import type { SQL } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MutationError, mutationRunner } from '../../server/source/Mutation'
import { emitter, generateJSONSchemas, generateTypes, JsonSchemaEmitter, TypeScriptEmitter } from '../index'

/**
 * Build a fake transaction client that returns one record for read-back queries.
 * @returns The fake SQL capability.
 */
function fakeSQL(): SQL {
  return {
    async unsafe(sql: string): Promise<Record<string, unknown>[]> {
      return sql.trimStart().startsWith('SELECT')
        ? [{ entity: 'Entity', id: '00000000-0000-4000-8000-000000000001', name: 'Record' }]
        : []
    },
  } as unknown as SQL
}

/**
 * Resolve one local JSON Schema reference.
 * @param schema - Schema containing `$defs`.
 * @param value - Candidate schema or `$ref`.
 * @returns The referenced schema, or the original value.
 */
function resolve(schema: Record<string, unknown>, value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.$ref !== 'string') return candidate
  const key = candidate.$ref.split('/').at(-1)
  const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined
  return key ? defs?.[key] : undefined
}

/**
 * Find a property through the composed parent shape chain.
 * @param schema - Entity operation schema.
 * @param entity - Entity name.
 * @param kind - Operation kind.
 * @param name - Property name.
 * @returns The property schema, when present.
 */
function property(
  schema: Record<string, unknown>,
  entity: string,
  kind: string,
  name: string,
): Record<string, unknown> | undefined {
  const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined
  const visit = (key: string | undefined): Record<string, unknown> | undefined => {
    if (!key) return undefined
    const def = defs?.[key]
    if (!def) return undefined
    const properties = def.properties as Record<string, unknown> | undefined
    if (properties && Object.hasOwn(properties, name)) return resolve(schema, properties[name])
    for (const parent of (def.allOf ?? []) as readonly { $ref?: string }[]) {
      const found = visit(parent.$ref?.split('/').at(-1))
      if (found) return found
    }
    return undefined
  }
  return visit(`${entity}_${kind}`)
}

/**
 * Collect required property names through the composed parent shape chain.
 * @param schema - Entity operation schema.
 * @param entity - Entity name.
 * @param kind - Operation kind.
 * @returns Required property names.
 */
function requiredNames(
  schema: Record<string, unknown>,
  entity: string,
  kind: string,
): readonly string[] {
  const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined
  const names = new Set<string>()
  const visit = (key: string | undefined): void => {
    if (!key) return
    const def = defs?.[key]
    if (!def) return
    for (const name of (def.required ?? []) as readonly string[]) names.add(name)
    for (const parent of (def.allOf ?? []) as readonly { $ref?: string }[]) {
      visit(parent.$ref?.split('/').at(-1))
    }
  }
  visit(`${entity}_${kind}`)
  return [...names].sort((left, right) => left.localeCompare(right))
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
    const noteCreate = schemas.Note?.create as Record<string, unknown>
    expect(property(noteCreate, 'Note', 'create', 'owner')?.type).toEqual(['string', 'null'])
    const noteOutput = schemas.Note?.output as Record<string, unknown>
    expect(property(noteOutput, 'Note', 'output', 'owner')?.anyOf).toBeDefined()
    expect(property(noteOutput, 'Note', 'output', 'dueOn')?.format).toBe('date')
    expect(property(noteOutput, 'Note', 'output', 'createdAt')?.format).toBe('date-time')
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
    const create = schemas.Thing?.create as Record<string, unknown> & {
      properties: Record<string, unknown>,
      propertyNames: { enum: readonly string[] },
    }
    expect(create.propertyNames.enum).toEqual(expect.arrayContaining(['name', 'score', 'title']))
    expect(requiredNames(create, 'Thing', 'create')).toEqual(['name', 'score', 'title'])
    expect(create.properties.id).toHaveProperty('anyOf')
    expect(create.properties.entity).toBeUndefined()
    expect(property(create, 'Thing', 'create', 'score')?.minimum).toBe(0)
    expect(property(create, 'Thing', 'create', 'score')?.maximum).toBe(10)
    expect(property(create, 'Thing', 'create', 'title')?.minLength).toBe(2)
    expect(property(create, 'Thing', 'create', 'title')?.maxLength).toBe(20)
    expect(property(create, 'Thing', 'create', 'nickname')?.readOnly).toBeUndefined()
  })

  test('emits nullable output contracts and TypeScript null unions from canonical fields', () => {
    const graph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
        {
          fields: [
            { field: 'nullableJSON', nullable: true, type: FieldType.JSON },
            { field: 'nullableOwner', target: 'User', type: FieldType.Entity },
            { field: 'nullableTags', items: { type: FieldType.String }, nullable: true, type: FieldType.Array },
            { field: 'nullableText', nullable: true, type: FieldType.String },
            { field: 'requiredJSON', type: FieldType.JSON },
            { field: 'requiredOwner', nullable: false, target: 'User', type: FieldType.Entity },
            { field: 'requiredTags', items: { type: FieldType.String }, type: FieldType.Array },
            { field: 'requiredText', type: FieldType.String },
          ],
          name: 'Thing',
        },
      ],
    })
    const types = generateTypes(graph)
    expect(types).toContain('readonly nullableText: string | null')
    expect(types).toContain('readonly requiredText: string')
    expect(types).toContain('readonly nullableTags: readonly string[] | null')
    expect(types).toContain('readonly requiredTags: readonly string[]')
    expect(types).toContain('readonly nullableOwner: UserRef | null')
    expect(types).toContain('readonly requiredOwner: UserRef')
    expect(types).not.toContain('readonly requiredOwner: UserRef | null')
    const schemas = generateJSONSchemas(graph)
    const validate = new Ajv({ allErrors: true }).compile(schemas.Thing?.output as object)
    const id = '00000000-0000-4000-8000-000000000001'
    const base = {
      entity: 'Thing',
      id,
      name: 'Thing',
      nullableJSON: null,
      nullableOwner: null,
      nullableTags: null,
      nullableText: null,
      requiredJSON: { active: true },
      requiredOwner: { entity: 'User', id, name: 'Owner' },
      requiredTags: ['a'],
      requiredText: 'Text',
    }
    expect(validate(base)).toBe(true)
    expect(validate({ ...base, nullableJSON: { active: true }, nullableTags: ['b'], nullableText: 'Text' }))
      .toBe(true)
    expect(validate({ ...base, requiredText: null })).toBe(false)
    expect(validate({ ...base, requiredTags: null })).toBe(false)
    expect(validate({ ...base, requiredOwner: null })).toBe(false)
    expect(validate({ ...base, requiredJSON: null })).toBe(false)
  })

  test('emits canonical identity formats and Snowflake create requiredness', async () => {
    const graph = new Graph({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'UuidThing' },
        { fields: [{ field: 'id', format: 'Snowflake' }], name: 'SnowThing' },
        { fields: [], name: 'AnyThing' },
      ],
    })
    const schemas = generateJSONSchemas(graph)
    const ajv = new Ajv({ allErrors: true })
    const uuidValidate = ajv.compile(schemas.UuidThing?.create as object)
    const snowValidate = ajv.compile(schemas.SnowThing?.create as object)
    const anyValidate = ajv.compile(schemas.AnyThing?.create as object)
    const uuid = '00000000-0000-4000-8000-000000000001'
    expect(uuidValidate({ name: 'UuidThing' })).toBe(true)
    expect(uuidValidate({ id: uuid, name: 'UuidThing' })).toBe(true)
    expect(uuidValidate({ id: 'garbage', name: 'UuidThing' })).toBe(false)
    expect(uuidValidate({ id: '123', name: 'UuidThing' })).toBe(false)
    expect(snowValidate({ name: 'SnowThing' })).toBe(false)
    expect(snowValidate({ id: '123', name: 'SnowThing' })).toBe(true)
    expect(snowValidate({ id: 'garbage', name: 'SnowThing' })).toBe(false)
    expect(anyValidate({ name: 'AnyThing' })).toBe(true)
    expect(anyValidate({ id: uuid, name: 'AnyThing' })).toBe(true)
    expect(anyValidate({ id: '123', name: 'AnyThing' })).toBe(true)
    expect(anyValidate({ id: 'garbage', name: 'AnyThing' })).toBe(false)
    const mutations = mutationRunner(graph.definitions, fakeSQL())
    await expect(mutations.create('SnowThing', { name: 'SnowThing' }))
      .rejects.toBeInstanceOf(MutationError)
    await expect(mutations.create('SnowThing', { id: 'garbage', name: 'SnowThing' }))
      .rejects.toBeInstanceOf(MutationError)
    expect(await mutations.create('SnowThing', { id: '123', name: 'SnowThing' }))
      .toMatchObject({ created: 1 })
    await expect(mutations.create('UuidThing', { id: 'garbage', name: 'UuidThing' }))
      .rejects.toBeInstanceOf(MutationError)
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
    const ajv = new Ajv({ allErrors: true })
    const validateCreate = ajv.compile(schemas.Thing?.create as object)
    const validateUpdate = ajv.compile(schemas.Thing?.update as object)
    const mutations = mutationRunner(graph.definitions, fakeSQL())
    const valid = { name: 'Valid', score: 5, title: 'Good' }
    expect(validateCreate(valid)).toBe(true)
    expect(await mutations.create('Thing', valid)).toMatchObject({ created: 1 })
    const validNull = { name: 'Null', nickname: null, score: 5, title: 'Good' }
    expect(validateCreate(validNull)).toBe(true)
    expect(await mutations.create('Thing', validNull)).toMatchObject({ created: 1 })
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
    const note = schemas.Note?.output as Record<string, unknown>
    const ownerField = property(note, 'Note', 'output', 'owner')
    const ownerRef = ownerField?.anyOf as { $ref?: string }[] | undefined
    const ownerIdentity = ownerRef?.[0]?.$ref?.split('/').at(-1)
    const defs = note.$defs as Record<string, { properties?: Record<string, { enum?: string[] }> }>
    expect(ownerIdentity).toBe('User_Identity')
    expect(defs.User_Identity?.properties?.entity?.enum).toContain('AdminUser')
    const user = schemas.User?.output as {
      properties: Record<string, { enum?: string[] }>,
    }
    expect(user.properties.entity.enum).toContain('AdminUser')
    const userCreate = schemas.User?.create as Record<string, unknown> & {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userCreate.properties.entity).toBeUndefined()
    expect(property(userCreate, 'User', 'create', 'name')).toBeDefined()
    const userUpdate = schemas.User?.update as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userUpdate.properties.entity).toBeUndefined()
  })

  test('composes inherited TypeScript and JSON Schema definitions', () => {
    const graph = new Graph({
      entities: [
        { fields: [{ field: 'base', type: FieldType.String }], name: 'Base' },
        { extends: 'Base', fields: [{ field: 'child', type: FieldType.String }], name: 'Child' },
        {
          extends: 'Child',
          fields: [{ field: 'grandchild', type: FieldType.String }],
          name: 'Grandchild',
        },
        {
          fields: [
            { field: 'optionalChild', target: 'Child', type: FieldType.Entity },
            { field: 'requiredChild', nullable: false, target: 'Child', type: FieldType.Entity },
          ],
          name: 'Holder',
        },
        {
          fields: [
            { field: 'label', type: FieldType.String },
            { field: 'parent', nullable: true, target: 'Node', type: FieldType.Entity },
          ],
          name: 'Node',
        },
      ],
    })
    const types = generateTypes(graph)
    expect(types).toContain('export enum Entities')
    expect(types).toContain("  Child = 'Child',")
    expect(types).toContain('export interface Child extends Base')
    expect(types).toContain('export interface Grandchild extends Child')
    expect(types).not.toContain('export interface Child extends Entity')
    expect(types).toContain('readonly entity: Entities.Grandchild')
    expect([...types.matchAll(/readonly base: string/gu)]).toHaveLength(1)

    const schemas = generateJSONSchemas(graph)
    const ajv = new Ajv({ allErrors: true })
    const childSchema = schemas.Grandchild?.output as {
      $defs: Record<string, { allOf?: { $ref?: string }[] }>,
      allOf?: { $ref?: string }[],
    }
    expect(childSchema.allOf?.[0]?.$ref).toBe('#/$defs/Grandchild_output')
    expect(childSchema.$defs.Grandchild_output?.allOf?.[0]?.$ref).toBe('#/$defs/Child_output')
    expect(childSchema.$defs.Child_output?.allOf?.[0]?.$ref).toBe('#/$defs/Base_output')
    const child = ajv.compile(schemas.Grandchild?.output as object)
    const id = '00000000-0000-4000-8000-000000000001'
    const childRow = {
      base: 'base',
      child: 'child',
      entity: 'Grandchild',
      grandchild: 'grandchild',
      id,
      name: 'Grandchild',
    }
    expect(child(childRow)).toBe(true)
    expect(child({ ...childRow, unknown: true })).toBe(false)
    expect(child({ child: 'child', entity: 'Grandchild', grandchild: 'grandchild', id, name: 'Grandchild' }))
      .toBe(false)
    const childCreate = ajv.compile(schemas.Grandchild?.create as object)
    expect(childCreate({ base: 'base', child: 'child', grandchild: 'grandchild', name: 'Grandchild' }))
      .toBe(true)
    expect(childCreate({
      base: 'base',
      child: 'child',
      grandchild: 'grandchild',
      name: 'Grandchild',
      unknown: true,
    })).toBe(false)

    const holder = ajv.compile(schemas.Holder?.output as object)
    const childRef = { entity: 'Grandchild', id, name: 'Grandchild' }
    const holderRow = { entity: 'Holder', id, name: 'Holder', requiredChild: childRef }
    expect(holder(holderRow)).toBe(true)
    expect(holder({ ...holderRow, optionalChild: null })).toBe(true)
    expect(holder({ ...holderRow, requiredChild: null })).toBe(false)
    expect(holder({ ...holderRow, optionalChild: childRef })).toBe(true)

    const node = ajv.compile(schemas.Node?.output as object)
    expect(node({ entity: 'Node', id, label: 'Root', name: 'Node', parent: null })).toBe(true)
    expect(node({
      entity: 'Node',
      id,
      label: 'Child',
      name: 'Child',
      parent: { entity: 'Node', id: '00000000-0000-4000-8000-000000000002', name: 'Root' },
    })).toBe(true)
  })

  test('narrows a concrete descendant discriminator from its abstract parent', () => {
    const graph = new Graph({
      entities: [
        { fields: [], name: 'Parent' },
        { extends: 'Parent', fields: [], name: 'OnlyChild' },
      ],
    })
    const types = generateTypes(graph)
    expect(types).toContain(`export interface Parent extends Entity {
  readonly entity: Entities.OnlyChild,
}`)
    expect(types).toContain(`export interface OnlyChild extends Parent {
  readonly entity: Entities.OnlyChild,
}`)
  })

  test('compiles mutually referencing generated entity types', async () => {
    const graph = new Graph({
      entities: [
        {
          fields: [{ field: 'peer', nullable: true, target: 'Bar', type: FieldType.Entity }],
          name: 'Foo',
        },
        {
          fields: [{ field: 'peer', nullable: true, target: 'Foo', type: FieldType.Entity }],
          name: 'Bar',
        },
      ],
    })
    const directory = await mkdtemp(join(tmpdir(), 'basis-mutual-types-'))
    try {
      const file = join(directory, 'types.ts')
      await writeFile(file, `
${generateTypes(graph)}
const foo: Foo = {
  entity: Entities.Foo,
  id: '1',
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  name: 'Foo',
  peer: null,
}
const bar: Bar = {
  entity: Entities.Bar,
  id: '2',
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  name: 'Bar',
  peer: foo,
}
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
const owner: Note['owner'] = { entity: Entities.AdminUser, id: '1', name: 'Admin' }
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
