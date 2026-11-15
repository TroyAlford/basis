import { FieldType, Graph } from 'basis/server'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateTypes } from '../index'

const graph = new Graph({
  entities: [
    { fields: [{ field: 'email', type: FieldType.String }], name: 'User' },
    {
      fields: [
        { field: 'owner', target: 'User', type: FieldType.Entity },
        { field: 'tags', items: { type: FieldType.String }, type: FieldType.Array },
        { field: 'title', type: FieldType.String },
      ],
      name: 'Note',
    },
    { fields: [{ field: 'base', type: FieldType.String }], name: 'Base' },
    { extends: 'Base', fields: [{ field: 'child', type: FieldType.String }], name: 'Child' },
    {
      fields: [
        { field: 'label', type: FieldType.String },
        { field: 'parent', nullable: true, target: 'Node', type: FieldType.Entity },
      ],
      name: 'Node',
    },
  ],
})

describe('Typed database facade', () => {
  test('connects generated maps to typed queries and mutations', async () => {
    await mkdir(join(process.cwd(), 'tmp'), { recursive: true })
    const directory = await mkdtemp(join(process.cwd(), 'tmp', 'typed-database-'))
    try {
      await writeFile(join(directory, 'generated.ts'), generateTypes(graph))
      await writeFile(join(directory, 'consumer.ts'), `
import { typedDatabase } from 'basis/server'
import type { CreateMap, EntityMap, ReferenceMap, UpdateMap } from './generated'

declare const db: ReturnType<typeof typedDatabase<EntityMap, CreateMap, UpdateMap, ReferenceMap>>
async function run() {
  const notes = await db.query('Note', {
    fields: ['id', 'title', 'owner.email', 'owner.name'],
  })
  const note = notes[0]
  if (note) {
    const id: string = note.id
    const title: string = note.title
    const email: string | null = note.owner ? note.owner.email : null
    // @ts-expect-error selected title is not a number
    const wrongTitle: number = note.title
    void id; void title; void email; void wrongTitle
  }
  const children = await db.query('Child', { fields: ['id', 'base', 'child'] })
  const child = children[0]
  if (child) {
    const base: string = child.base
    const local: string = child.child
    void base; void local
  }
  const nodes = await db.query('Node', { fields: ['id', 'parent.parent.name'] })
  const node = nodes[0]
  if (node) {
    const parentName: string | null = node.parent ? node.parent.parent?.name ?? null : null
    void parentName
  }
  void await db.query('Node', { fields: ['parent.parent.parent.parent.parent.name'] })
  void await db.query('Node', {
    fields: ['parent.parent.parent.parent.parent.parent.parent.parent.name'],
  })
  // @ts-expect-error exceeds the canonical eight-reference-hop depth
  await db.query('Node', { fields: ['parent.parent.parent.parent.parent.parent.parent.parent.parent.name'] })
  const created = await db.create('Note', {
    name: 'Note',
    owner: 'user-id',
    tags: ['a'],
    title: 'Title',
  })
  const createdTitle: string | undefined = created.record?.title
  void createdTitle
  await db.edit('Note', 'id == 1', { title: 'Next' })
  await db.edit('Base', 'id == 1', { base: 'Next' })
  await db.upsert('Note', 'id == 1', { title: 'Next' })
  await db.delete('Note', 'id == 1')
  const transactional = await db.tx(async tx => {
    const created = await tx.create('Note', {
      name: 'Note',
      owner: 'user-id',
      tags: ['a'],
      title: 'Transactional',
    })
    await tx.delete('Note', 'id == 1')
    // @ts-expect-error Graph projection queries are top-level only
    await tx.query('Note', { fields: ['id', 'title'] })
    // @ts-expect-error invalid entity inside a typed transaction
    await tx.create('Missing', { name: 'Missing' })
    return created
  })
  const transactionalTitle: string | undefined = transactional.record?.title
  void transactionalTitle
  // @ts-expect-error invalid entity name
  await db.query('Missing', { fields: ['id'] })
  // @ts-expect-error abstract entities are queryable but not constructible
  await db.create('Base', { base: 'Base', name: 'Base' })
  // @ts-expect-error invalid entity name in delete
  await db.delete('Missing', 'id == 1')
  // @ts-expect-error invalid projection field
  await db.query('Note', { fields: ['missing'] })
  // @ts-expect-error array index projections are not supported
  await db.query('Note', { fields: ['tags.0'] })
  // @ts-expect-error create references use canonical identity strings
  await db.create('Note', { name: 'Note', owner: { id: 'user-id' }, title: 'Title' })
  // @ts-expect-error edit changes do not accept identity
  await db.edit('Note', 'id == 1', { id: '1' })
}
void run
`)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { types: ['bun-types'] },
        extends: '../../tsconfig.json',
        include: ['./consumer.ts'],
      }, null, 2))
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          './node_modules/@typescript/native/bin/tsc',
          '-p',
          join(directory, 'tsconfig.json'),
          '--noEmit',
          '--skipLibCheck',
        ],
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      })
      expect(result.exitCode, result.stderr.toString() || result.stdout.toString()).toBe(0)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)
})
