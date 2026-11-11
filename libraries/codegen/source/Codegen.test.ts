import { Cardinality, FieldType, Graph } from 'basis/server'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateJSONSchemas, generateTypes } from './Codegen'

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
    expect(userCreate.properties.entity.enum).toContain('AdminUser')
    expect(userCreate.properties.entity.const).toBeUndefined()
    const userUpdate = schemas.User?.update as {
      properties: Record<string, { const?: string, enum?: string[] }>,
    }
    expect(userUpdate.properties.entity.enum).toContain('AdminUser')
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
