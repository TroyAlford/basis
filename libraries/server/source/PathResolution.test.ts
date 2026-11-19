import { describe, expect, test } from 'bun:test'
import { EntityDefinitions, FieldType } from './EntityDefinitions'
import type { GraphPathStep, ResolvedGraphPath } from './PathResolution'
import { resolveGraphPath } from './PathResolution'

/**
 * Load one canonical fixture through its authored JSON representation.
 * @param value - Authored entity document.
 * @returns Validated entity definitions.
 */
function load(value: unknown): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify(value))
}

const baseDocuments = {
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'User' },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'members', target: 'User', type: 'Collection', via: 'Membership[workspace = @].user' },
      ],
      name: 'Workspace',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { cardinality: 'Many', field: 'sections', inverse: 'document', target: 'Section', type: 'Inverse' },
      ],
      name: 'Document',
    },
    {
      extends: 'Document',
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'code', type: 'String' },
      ],
      name: 'PublicDocument',
    },
    {
      extends: 'Document',
      fields: [
        { field: 'workspace', target: 'Workspace', type: 'Entity' },
        { field: 'code', type: 'String' },
      ],
      name: 'PrivateDocument',
    },
    {
      fields: [
        { field: 'document', inverse: 'sections', target: 'Document', type: 'Entity' },
        { field: 'title', type: 'String' },
      ],
      name: 'Section',
    },
  ],
  relationships: [{
    between: [
      { field: 'workspace', target: 'Workspace' },
      { field: 'user', target: 'User' },
    ],
    fields: [],
    name: 'Membership',
  }],
}

const definitions = load(baseDocuments)
const document = definitions.entity('Document')
const section = definitions.entity('Section')
if (!document || !section) throw new Error('missing fixture entity')

/**
 * Return the canonical path result, failing the test on a resolver error.
 * @param start - Starting entity.
 * @param path - Path to resolve.
 * @returns The resolved path.
 */
function resolved(start: typeof document, path: string): ResolvedGraphPath {
  const result = resolveGraphPath(definitions, start, path)
  if (!('branches' in result)) throw new Error(`path "${path}" failed: ${JSON.stringify(result)}`)
  return result
}

/**
 * Find the field and reference steps in one branch.
 * @param result - Resolved path.
 * @param index - Branch index.
 * @returns The branch steps.
 */
function steps(result: ResolvedGraphPath, index = 0): readonly GraphPathStep[] {
  const branch = result.branches[index]
  if (!branch) throw new Error(`missing branch ${index}`)
  return branch.steps
}

describe('canonical Graph path resolution', () => {
  test('resolves an ordinary inherited reference path', () => {
    const result = resolved(section, 'document.name')
    expect(result.kind).toBe('field')
    expect(steps(result)).toMatchObject([
      { field: { name: 'document', owner: 'Section', target: 'Document' }, kind: 'reference' },
      { field: { name: 'name', owner: 'Entity' }, kind: 'field' },
    ])
  })

  test('resolves a descendant-only scalar through every compatible branch', () => {
    const result = resolved(section, 'document.code')
    expect(result.kind).toBe('field')
    expect(result.kind === 'field' ? result.field.type : undefined).toBe(FieldType.String)
    expect(result.branches).toHaveLength(2)
    expect(steps(result, 0)).toMatchObject([
      { field: { name: 'document', owner: 'Section' }, kind: 'reference' },
      {
        field: { name: 'code', owner: 'PublicDocument' },
        guard: { leaves: ['PublicDocument'], occurrence: 1 },
        kind: 'field',
      },
    ])
    expect(steps(result, 1)).toMatchObject([
      { field: { name: 'document', owner: 'Section' }, kind: 'reference' },
      {
        field: { name: 'code', owner: 'PrivateDocument' },
        guard: { leaves: ['PrivateDocument'], occurrence: 1 },
        kind: 'field',
      },
    ])
  })

  test('resolves a descendant-only reference with a concrete guard', () => {
    const result = resolved(section, 'document.workspace')
    expect(result.branches).toHaveLength(2)
    expect(steps(result, 0)).toMatchObject([
      { field: { name: 'document', owner: 'Section' }, kind: 'reference' },
      {
        field: { name: 'workspace', owner: 'PublicDocument', target: 'Workspace' },
        guard: { leaves: ['PublicDocument'], occurrence: 1 },
        kind: 'reference',
      },
    ])
    expect(result.kind === 'field' ? result.identity : false).toBe(true)
  })

  test('resolves a descendant collection through the guarded reference', () => {
    const result = resolved(section, 'document.workspace.members')
    expect(result.kind).toBe('collection')
    expect(result.branches).toHaveLength(2)
    expect(steps(result, 0)).toMatchObject([
      { field: { name: 'document', owner: 'Section' }, kind: 'reference' },
      {
        field: { name: 'workspace', owner: 'PublicDocument' },
        guard: { leaves: ['PublicDocument'], occurrence: 1 },
        kind: 'reference',
      },
      { collection: { name: 'members', target: 'User' }, kind: 'collection' },
    ])
  })

  test('retains compatible sibling references with different physical owners', () => {
    const result = resolved(section, 'document.workspace')
    expect(result.branches.map(branch => branch.steps.at(-1))).toMatchObject([
      { field: { owner: 'PublicDocument' }, guard: { leaves: ['PublicDocument'] } },
      { field: { owner: 'PrivateDocument' }, guard: { leaves: ['PrivateDocument'] } },
    ])
  })

  test('retains compatible sibling scalars with different physical owners', () => {
    const result = resolved(section, 'document.code')
    expect(result.branches.map(branch => branch.steps.at(-1))).toMatchObject([
      { field: { owner: 'PublicDocument' }, guard: { leaves: ['PublicDocument'] } },
      { field: { owner: 'PrivateDocument' }, guard: { leaves: ['PrivateDocument'] } },
    ])
  })

  test('rejects incompatible sibling declarations', () => {
    const incompatible = load({
      entities: [
        { fields: [], name: 'Document' },
        { extends: 'Document', fields: [{ field: 'code', type: 'String' }], name: 'PublicDocument' },
        { extends: 'Document', fields: [{ field: 'code', type: 'Number' }], name: 'PrivateDocument' },
        { fields: [{ field: 'document', target: 'Document', type: 'Entity' }], name: 'Section' },
      ],
    })
    const start = incompatible.entity('Section')
    if (!start) throw new Error('missing Section')
    expect(resolveGraphPath(incompatible, start, 'document.code')).toMatchObject({
      kind: 'incompatible',
      segment: 'code',
    })
  })

  test('omits branches that do not declare a descendant path', () => {
    const missing = load({
      entities: [
        { fields: [], name: 'Document' },
        { extends: 'Document', fields: [{ field: 'code', type: 'String' }], name: 'PublicDocument' },
        {
          extends: 'Document',
          fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
          name: 'PrivateDocument',
        },
        { fields: [], name: 'Workspace' },
        { fields: [{ field: 'document', target: 'Document', type: 'Entity' }], name: 'Section' },
      ],
    })
    const start = missing.entity('Section')
    if (!start) throw new Error('missing Section')
    const result = resolveGraphPath(missing, start, 'document.workspace')
    if (!('branches' in result)) throw new Error('unexpected resolver failure')
    expect(result.branches).toHaveLength(1)
    expect(result.branches[0]?.steps.at(-1)).toMatchObject({
      field: { owner: 'PrivateDocument' },
      guard: { leaves: ['PrivateDocument'] },
    })
  })

  test('rejects a path absent from every concrete branch', () => {
    expect(resolveGraphPath(definitions, section, 'document.missing')).toMatchObject({
      kind: 'unknown',
      path: 'document.missing',
    })
  })

  test('attaches nested guards to the correct source occurrence', () => {
    const result = resolved(section, 'document.workspace.members')
    expect(steps(result)[1]).toMatchObject({
      guard: { leaves: ['PublicDocument'], occurrence: 1 },
    })
  })

  test('enforces the maximum reference depth', () => {
    const deep = load({
      entities: [{
        fields: [
          { field: 'parent', target: 'Node', type: 'Entity' },
          { field: 'title', type: 'String' },
        ],
        name: 'Node',
      }],
    })
    const start = deep.entity('Node')
    if (!start) throw new Error('missing Node')
    const path = `${Array.from({ length: 9 }, () => 'parent').join('.')}.title`
    expect(resolveGraphPath(deep, start, path)).toMatchObject({ kind: 'depth', path })
  })

  test('resolves the universal discriminator through the canonical root field', () => {
    const result = resolved(section, 'document.entity')
    expect(result.kind).toBe('field')
    expect(steps(result)).toMatchObject([
      { field: { name: 'document', owner: 'Section' }, kind: 'reference' },
      { field: { name: 'entity', owner: 'Entity' }, kind: 'field' },
    ])
  })
})
