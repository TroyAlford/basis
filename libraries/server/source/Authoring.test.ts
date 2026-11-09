import { renderMermaidSVG } from 'beautiful-mermaid'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateErd, generateJSONSchemas, generateProducts, generateTypes } from './Authoring'
import { EntityDefinitions, FieldType } from './EntityDefinitions'
import { Graph } from './Graph'
import { Cardinality } from './GraphAuthoring'

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

describe('typed authoring and generated products', () => {
  test('uses the canonical validator and produces the same physical model as JSON', () => {
    const typed = EntityDefinitions.fromDocument(document)
    const json = EntityDefinitions.load(JSON.stringify(document))
    expect(typed.physicalSchema('basis_app', false, false))
      .toEqual(json.physicalSchema('basis_app', false, false))
    expect(generateProducts(typed)).toEqual(generateProducts(json))
    expect(typed.entities.map(entity => entity.name)).toEqual(['User', 'Note'])
    const graph = new Graph({ entities: document })
    expect(graph.definitions.entity('Note')?.effectiveFields.some(field => field.name === 'owner')).toBe(true)
  })

  test('generates deterministic types, schemas, and both ERDs', () => {
    const definitions = EntityDefinitions.fromDocument(document)
    const first = generateProducts(definitions)
    const second = generateProducts(definitions)
    expect(first).toEqual(second)
    expect(first.types).toContain('export interface Note extends Entity')
    expect(first.types).toContain('export type EntityRef')
    expect(first.types).toContain('export type NoteRef')
    expect(first.types).toContain('readonly owner: UserRef | null')
    expect(first.types).toContain('readonly subject: EntityRef | null')
    expect(first.types).not.toContain('Projection')
    expect(first.schemas.Note?.output).toBeDefined()
    expect(first.schemas.Note?.create).toBeDefined()
    expect((first.schemas.Note?.create as {
      properties: Record<string, { type?: unknown }>,
    }).properties.owner?.type).toEqual(['string', 'null'])
    expect((first.schemas.Note?.output as {
      properties: Record<string, { anyOf?: unknown }>,
    }).properties.owner?.anyOf).toBeDefined()
    expect((first.schemas.Note?.output as {
      properties: Record<string, { format?: string }>,
    }).properties.dueOn?.format).toBe('date')
    expect((first.schemas.Note?.output as {
      properties: Record<string, { format?: string }>,
    }).properties.createdAt?.format).toBe('date-time')
    expect(first.logicalErd).toContain('erDiagram')
    expect(first.logicalErd).toContain('User ||--o{ Note : owner')
    expect(first.logicalErd).toContain('Ref owner "nullable"')
    expect(first.logicalErd).toContain('string[] tags')
    expect(first.physicalErd).toContain('Entity ||--o{ User : id')
    expect(first.physicalErd).toContain('Note')
    expect(generateTypes(definitions)).toBe(first.types)
    expect(generateJSONSchemas(definitions)).toEqual(first.schemas)
    expect(generateErd(definitions, 'logical')).toBe(first.logicalErd)
    expect(generateErd(definitions, 'physical')).toBe(first.physicalErd)
    const svg = renderMermaidSVG(first.logicalErd)
    expect(svg).toContain('owner')
    expect(svg).toContain('tags')
  })

  test('uses concrete descendants for abstract reference output discriminators', () => {
    const abstract = EntityDefinitions.fromDocument({
      entities: [
        { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        {
          fields: [{ field: 'owner', target: 'User', type: FieldType.Entity }],
          name: 'Note',
        },
      ],
    })
    const products = generateProducts(abstract)
    const note = products.schemas.Note?.output as {
      properties: Record<string, { anyOf?: { properties?: Record<string, unknown> }[] }>,
    }
    const owner = note.properties.owner?.anyOf?.[0]?.properties?.entity as {
      enum?: string[],
    } | undefined
    expect(owner?.enum).toContain('AdminUser')
    const user = products.schemas.User?.output as {
      properties: Record<string, { enum?: string[] }>,
    }
    expect(user.properties.entity.enum).toContain('AdminUser')
    const userCreate = products.schemas.User?.create as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userCreate.properties.entity.enum).toContain('AdminUser')
    expect(userCreate.properties.entity.const).toBeUndefined()
    const userUpdate = products.schemas.User?.update as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userUpdate.properties.entity.enum).toContain('AdminUser')
  })

  test('emits assignable abstract reference types', async () => {
    const abstract = EntityDefinitions.fromDocument({
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
      await writeFile(file, [
        generateTypes(abstract),
        "const owner: Note['owner'] = { entity: 'AdminUser', id: '1', name: 'Admin' }",
      ].join('\n'))
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
      await writeFile(file, generateTypes(EntityDefinitions.fromDocument(document)))
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
