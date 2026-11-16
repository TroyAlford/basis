import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { Logger } from 'basis/logger'
import { Cardinality, FieldType, Graph } from 'basis/server'
import { runAsync } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GeneratedSchemas } from '../index'
import { emitter, generateJSONSchemas, generateTypes, JsonSchemaEmitter, TypeScriptEmitter } from '../index'

const silent = new Logger({ silent: true })

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

/**
 * Create one standards-compliant Draft 2020-12 validator.
 * @returns The configured validator.
 */
function createValidator(): Ajv2020 {
  const validator = new Ajv2020({ allErrors: true })
  addFormats(validator)
  return validator
}

/**
 * Compile one entity definition with its shared `$defs`.
 * @param schemas - Generated JSON Schema document.
 * @param entity - Entity definition name.
 * @returns A validating function.
 */
function compileEntity(schemas: GeneratedSchemas, entity: string) {
  return createValidator().compile({
    $defs: schemas.$defs,
    $ref: `#/$defs/${entity}`,
    $schema: schemas.$schema,
  })
}

/**
 * Type-check one generated TypeScript file without blocking the test runner.
 * @param file - Generated file path.
 * @returns The process exit code and captured diagnostics.
 */
async function typecheck(file: string): Promise<{ readonly exitCode: number, readonly output: string }> {
  const result = await runAsync(process.execPath, [
    './node_modules/@typescript/native/bin/tsc',
    '--ignoreConfig',
    '--noEmit',
    '--skipLibCheck',
    '--strict',
    file,
  ], { cwd: process.cwd(), logger: silent })
  return { exitCode: result.exitCode, output: result.stderr || result.stdout }
}

describe('codegen', () => {
  test('generates entity TypeScript and one interoperable JSON Schema document', () => {
    const graph = new Graph({ entities: document })
    const types = generateTypes(graph)
    const schemas = generateJSONSchemas(graph)
    expect(types).toContain('export enum $BasisEntities')
    expect(types).toContain('export interface Note extends Entity')
    expect(types).toContain('export interface Reference')
    expect(types).toContain('readonly owner: Reference | null')
    expect(types).toContain('readonly subject: Reference | null')
    expect(schemas.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(createValidator().validateSchema(schemas)).toBe(true)
    const validate = compileEntity(schemas, 'Note')
    const id = '00000000-0000-4000-8000-000000000001'
    expect(validate({
      createdAt: '2020-01-01T00:00:00.000Z',
      dueOn: '2020-01-01',
      entity: 'Note',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      metadata: { kind: 'note' },
      name: 'Note',
      owner: { entity: 'User', id, name: 'Owner' },
      subject: null,
      tags: ['a'],
      title: 'Title',
    })).toBe(true)
    expect(validate({
      createdAt: '2020-01-01T00:00:00.000Z',
      dueOn: '2020-01-01',
      entity: 'Note',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      metadata: { kind: 'note' },
      name: 'Note',
      owner: { entity: 'Note', id, name: 'Wrong target' },
      subject: null,
      tags: ['a'],
      title: 'Title',
    })).toBe(false)
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
      ) as GeneratedSchemas
      expect(types).toContain('export interface EmitterNote')
      expect(createValidator().validateSchema(schemas)).toBe(true)
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

  test('composes parent entities and references through $defs/$ref', () => {
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
    const schemas = generateJSONSchemas(graph)
    const id = '00000000-0000-4000-8000-000000000001'
    const childRepresentation = {
      base: 'base',
      child: 'child',
      entity: 'Grandchild',
      grandchild: 'grandchild',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Grandchild',
    }
    const childIdentity = { entity: 'Grandchild', id, name: 'Grandchild' }
    expect(compileEntity(schemas, 'Grandchild')(childRepresentation)).toBe(true)
    expect(compileEntity(schemas, 'Grandchild')({ child: 'child', entity: 'Grandchild', id, name: 'Grandchild' }))
      .toBe(false)
    expect(compileEntity(schemas, 'Holder')({
      entity: 'Holder',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Holder',
      optionalChild: null,
      requiredChild: childIdentity,
    })).toBe(true)
    expect(compileEntity(schemas, 'Holder')({
      entity: 'Holder',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Holder',
      requiredChild: null,
    })).toBe(false)
    const nodeSchema = compileEntity(schemas, 'Node')
    expect(nodeSchema({
      entity: 'Node',
      id,
      label: 'Root',
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Node',
      parent: null,
    })).toBe(true)
    expect(nodeSchema({
      entity: 'Node',
      id,
      label: 'Child',
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Child',
      parent: { entity: 'Node', id: '00000000-0000-4000-8000-000000000002', name: 'Root' },
    })).toBe(true)
  })

  test('preserves canonical bounds, nullability, and identity formats', () => {
    const graph = new Graph({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'UuidThing' },
        { fields: [{ field: 'id', format: 'Snowflake' }], name: 'SnowThing' },
        {
          fields: [
            { field: 'score', maximum: 10, minimum: 0, type: FieldType.Number },
            { field: 'title', maxLength: 20, minLength: 2, type: FieldType.String },
            { field: 'nickname', nullable: true, type: FieldType.String },
            { field: 'tags', items: { type: FieldType.String }, nullable: true, type: FieldType.Array },
          ],
          name: 'Thing',
        },
      ],
    })
    const schemas = generateJSONSchemas(graph)
    const validate = compileEntity(schemas, 'Thing')
    const uuid = compileEntity(schemas, 'UuidThing')
    const snowflake = compileEntity(schemas, 'SnowThing')
    const id = '00000000-0000-4000-8000-000000000001'
    const identityBase = { lastUpdatedAt: null, lastUpdatedBy: null }
    expect(uuid({ ...identityBase, entity: 'UuidThing', id, name: 'Uuid' })).toBe(true)
    expect(uuid({ ...identityBase, entity: 'UuidThing', id: 'not-a-uuid', name: 'Uuid' })).toBe(false)
    expect(snowflake({ ...identityBase, entity: 'SnowThing', id, name: 'Snow' })).toBe(false)
    expect(snowflake({ ...identityBase, entity: 'SnowThing', id: '123456789', name: 'Snow' })).toBe(true)
    const thing = {
      entity: 'Thing',
      id,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Thing',
      nickname: null,
      score: 5,
      tags: null,
      title: 'Good',
    }
    expect(validate(thing)).toBe(true)
    expect(validate({ ...thing, score: 11 })).toBe(false)
    expect(validate({ ...thing, title: 'G' })).toBe(false)
    expect(validate({ entity: 'Thing', id, name: 'Thing', score: 5, title: 'Good' })).toBe(false)
    const { nickname, ...withoutNickname } = thing
    void nickname
    expect(validate(withoutNickname)).toBe(false)
    expect(validate({ ...thing, lastUpdatedAt: undefined })).toBe(false)
  })

  test('emits composed TypeScript inheritance, enums, and reference links', () => {
    const graph = new Graph({
      entities: [
        { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
        { fields: [{ field: 'base', type: FieldType.String }], name: 'Base' },
        { extends: 'Base', fields: [{ field: 'child', type: FieldType.String }], name: 'Child' },
        {
          extends: 'Child',
          fields: [{ field: 'grandchild', type: FieldType.String }],
          name: 'Grandchild',
        },
        {
          fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }],
          name: 'Note',
        },
      ],
    })
    const types = generateTypes(graph)
    expect(types).toContain('export enum $BasisEntities')
    expect(types).toContain('export interface Child extends Base')
    expect(types).toContain('export interface Grandchild extends Child')
    expect(types).not.toContain('export interface Child extends Entity')
    expect(types).toContain('readonly owner: Reference | null')
    expect([...types.matchAll(/readonly base: string/gu)]).toHaveLength(1)
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
readonly entity: $BasisEntities.OnlyChild,
}`)
    expect(types).toContain(`export interface OnlyChild extends Parent {
readonly entity: $BasisEntities.OnlyChild,
}`)
  })

  test('keeps legitimate entity names collision-safe in emitted TypeScript', async () => {
    const graph = new Graph({
      entities: [
        { fields: [], name: 'Foo' },
        { fields: [], name: 'FooCreate' },
        { fields: [], name: 'FooUpdate' },
      ],
    })
    const types = generateTypes(graph)
    expect(types).toContain('export interface Foo extends Entity')
    expect(types).toContain('export interface FooCreate extends Entity')
    expect(types).toContain('export interface FooUpdate extends Entity')
    expect(types).toContain('export interface Reference {')
    expect(types).toContain('export interface Entity extends Reference')
    expect(types).not.toContain('export type FooCreate =')
    expect(types).not.toContain('export type FooUpdate =')
    expect(() => new Graph({
      entities: [{ fields: [], name: 'Reference' }],
    })).toThrow('reserved for generated contracts')
    const directory = await mkdtemp(join(tmpdir(), 'basis-collision-types-'))
    try {
      const file = join(directory, 'types.ts')
      await writeFile(file, types)
      const result = await typecheck(file)
      expect(result.exitCode, result.output).toBe(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

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
  entity: $BasisEntities.Foo,
  id: '1',
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  name: 'Foo',
  peer: null,
}
const bar: Bar = {
  entity: $BasisEntities.Bar,
  id: '2',
  lastUpdatedAt: null,
  lastUpdatedBy: null,
  name: 'Bar',
  peer: foo,
}
      `.trim())
      const result = await typecheck(file)
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
const owner: Note['owner'] = { entity: $BasisEntities.AdminUser, id: '1', name: 'Admin' }
      `.trim())
      const result = await typecheck(file)
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

  test('emits named enum contracts in TypeScript and JSON Schema', async () => {
    const graph = new Graph({
      entities: [{
        fields: [
          { enum: 'AccessLevel', field: 'access', type: FieldType.Enum },
          { enum: 'AccessLevel', field: 'fallback', nullable: true, type: FieldType.Enum },
        ],
        name: 'EnumDocument',
      }],
      enums: {
        AccessLevel: {
          editor: 'Can edit resources.',
          owner: 'Can manage resources and membership.',
          viewer: 'Can view resources.',
        },
      },
    })
    const types = generateTypes(graph)
    expect(types).toContain('export enum AccessLevel {')
    expect(types).toContain('/** Can manage resources and membership. */')
    expect(types).toContain("Owner = 'owner',")
    expect(types).toContain('readonly access: AccessLevel,')
    expect(types).toContain('readonly fallback: AccessLevel | null,')
    const schemas = generateJSONSchemas(graph)
    expect(createValidator().validateSchema(schemas)).toBe(true)
    const validate = compileEntity(schemas, 'EnumDocument')
    const base = {
      entity: 'EnumDocument',
      id: '00000000-0000-4000-8000-000000000001',
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      name: 'Document',
    }
    expect(validate({ ...base, access: 'owner', fallback: null })).toBe(true)
    expect(validate({ ...base, access: 'owner', fallback: 'viewer' })).toBe(true)
    expect(validate({ ...base, access: 'invalid', fallback: null })).toBe(false)

    const directory = await mkdtemp(join(tmpdir(), 'basis-enum-types-'))
    try {
      const file = join(directory, 'types.ts')
      await writeFile(file, `
${types}
const access: EnumDocument['access'] = AccessLevel.Owner
void access
      `.trim())
      const result = await typecheck(file)
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
      const result = await typecheck(file)
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)
})
