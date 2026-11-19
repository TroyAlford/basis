import { describe, expect, test } from 'bun:test'
import { EntityDefinitions, identityDefinition } from './EntityDefinitions'
import { MAX_GRAPH_PATH_DEPTH, resolvePredicatePath } from './PathResolution'

/**
 * Load entity definitions through their canonical JSON representation.
 * @param value - Parsed JSON input.
 * @returns The validated definitions.
 */
function load(value: unknown): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify(value))
}

/**
 * Resolve one predicate path from a named entity or the universal root.
 * @param definitions - Canonical definitions.
 * @param entity - Start entity name.
 * @param path - Logical path.
 * @returns The resolved path or failure.
 */
function resolve(definitions: EntityDefinitions, entity: string, path: string) {
  const start = entity === 'Entity' ? identityDefinition() : definitions.entity(entity)
  if (!start) throw new Error(`missing entity ${entity}`)
  return resolvePredicatePath(start, path, { definitions })
}

/**
 * Require a successful predicate path.
 * @param result - Resolution result.
 * @returns The resolved path.
 */
function resolved(result: ReturnType<typeof resolve>) {
  if ('kind' in result) throw new Error(`path failed: ${result.kind}`)
  return result
}

const scalarDefinitions = load({
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
    { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'B' },
    { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'C' },
    { extends: 'A', fields: [], name: 'D' },
  ],
})

const declaredDefinitions = load({
  entities: [
    { fields: [{ field: 'foo', type: 'Number' }], name: 'A' },
    { extends: 'A', fields: [], name: 'B' },
  ],
})

describe('PathResolution.resolvePredicatePath', () => {
  test('resolves direct and inherited fields without eligibility restrictions', () => {
    const direct = resolved(resolve(declaredDefinitions, 'A', 'foo'))
    expect(direct).toMatchObject({
      eligibility: [],
      path: 'foo',
      terminal: { name: 'foo', type: 'Number' },
      variants: [{ fields: [{ name: 'foo', owner: 'A' }] }],
    })

    const inherited = resolved(resolve(declaredDefinitions, 'B', 'foo'))
    expect(inherited).toMatchObject({
      eligibility: [],
      path: 'foo',
      terminal: { name: 'foo', type: 'Number' },
      variants: [{ fields: [{ name: 'foo', owner: 'A' }] }],
    })
  })

  test('reports concrete eligibility for descendant-only fields and retains owners', () => {
    const path = resolved(resolve(scalarDefinitions, 'A', 'foo'))
    expect(path).toMatchObject({
      eligibility: [{ entityTypes: ['B', 'C'], occurrence: 0, path: 'entity' }],
      path: 'foo',
      terminal: { name: 'foo', type: 'Number' },
      variants: [
        { fields: [{ name: 'foo', owner: 'B' }] },
        { fields: [{ name: 'foo', owner: 'C' }] },
      ],
    })
  })

  test('includes inherited concrete grandchildren in the eligible set', () => {
    const definitions = load({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
        { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'B' },
        { extends: 'B', fields: [], name: 'E' },
        { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'C' },
        { extends: 'A', fields: [], name: 'D' },
      ],
    })
    const path = resolved(resolve(definitions, 'A', 'foo'))
    expect(path).toMatchObject({
      eligibility: [{ entityTypes: ['E', 'C'], occurrence: 0, path: 'entity' }],
      path: 'foo',
      terminal: { name: 'foo', type: 'Number' },
      variants: [
        { fields: [{ name: 'foo', owner: 'B' }] },
        { fields: [{ name: 'foo', owner: 'C' }] },
      ],
    })
  })

  test('fails when a field is missing from every concrete descendant', () => {
    expect(resolve(scalarDefinitions, 'A', 'missing')).toEqual({
      entity: 'A',
      kind: 'unknown',
      path: 'missing',
    })
  })

  test('assigns a descendant reference restriction to the referenced occurrence', () => {
    const definitions = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'document', target: 'Document', type: 'Entity' },
          ],
          name: 'Section',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
        { extends: 'Document', fields: [], name: 'PublicDocument' },
        {
          extends: 'Document',
          fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
          name: 'PrivateDocument',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'members',
              inverse: 'workspace',
              target: 'Member',
              type: 'Inverse',
            },
          ],
          name: 'Workspace',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'workspace', inverse: 'members', target: 'Workspace', type: 'Entity' },
          ],
          name: 'Member',
        },
      ],
    })
    const path = resolved(resolve(definitions, 'Section', 'document.workspace.members'))
    expect(path).toMatchObject({
      eligibility: [{
        entityTypes: ['PrivateDocument'],
        occurrence: 1,
        path: 'document.entity',
      }],
      path: 'document.workspace.members',
      terminal: { name: 'members', target: 'Member' },
      variants: [{
        fields: [
          { name: 'document' },
          { name: 'workspace', owner: 'PrivateDocument' },
          { name: 'members' },
        ],
        restrictions: [{
          entityTypes: ['PrivateDocument'],
          occurrence: 1,
          path: 'document.entity',
        }],
      }],
    })
  })

  test('keeps each abstract reference restriction on its own occurrence', () => {
    const definitions = load({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'document', target: 'Document', type: 'Entity' },
          ],
          name: 'Section',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Document' },
        { extends: 'Document', fields: [], name: 'PublicDocument' },
        {
          extends: 'Document',
          fields: [{ field: 'workspace', target: 'Workspace', type: 'Entity' }],
          name: 'PrivateDocument',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Workspace' },
        { extends: 'Workspace', fields: [], name: 'PublicWorkspace' },
        {
          extends: 'Workspace',
          fields: [{ field: 'team', target: 'Team', type: 'Entity' }],
          name: 'PrivateWorkspace',
        },
        { fields: [{ field: 'id', format: 'UUID' }, { field: 'label', type: 'String' }], name: 'Team' },
      ],
    })
    const path = resolved(resolve(definitions, 'Section', 'document.workspace.team.label'))
    expect(path).toMatchObject({
      eligibility: [
        {
          entityTypes: ['PrivateDocument'],
          occurrence: 1,
          path: 'document.entity',
        },
        {
          entityTypes: ['PrivateWorkspace'],
          occurrence: 2,
          path: 'document.workspace.entity',
        },
      ],
      path: 'document.workspace.team.label',
      terminal: { name: 'document.workspace.team.label', type: 'String' },
    })
  })

  test('retains distinct physical relationships for compatible sibling collections', () => {
    const definitions = load({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
        {
          extends: 'A',
          fields: [{
            cardinality: 'Many',
            field: 'members',
            inverse: 'b',
            target: 'User',
            type: 'Inverse',
          }],
          name: 'B',
        },
        { extends: 'A', fields: [], name: 'C' },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'b', inverse: 'members', target: 'B', type: 'Entity' },
          ],
          name: 'User',
        },
      ],
      relationships: [{
        between: [
          { field: 'c', inverse: 'members', target: 'C' },
          { field: 'user', inverse: 'users', target: 'User' },
        ],
        fields: [],
        name: 'CMembership',
      }],
    })
    const path = resolved(resolve(definitions, 'A', 'members'))
    expect(path).toMatchObject({
      eligibility: [{ entityTypes: ['B', 'C'], occurrence: 0, path: 'entity' }],
      path: 'members',
      terminal: { name: 'members', target: 'User' },
      variants: [
        { fields: [{ kind: 'inverse', name: 'members', target: 'User' }] },
        { fields: [{ kind: 'relationship', name: 'members', target: 'User' }] },
      ],
    })
  })

  test('traverses nullable references normally', () => {
    const definitions = load({
      entities: [
        {
          fields: [
            { field: 'owner', nullable: true, target: 'User', type: 'Entity' },
          ],
          name: 'B',
        },
        { fields: [{ field: 'label', type: 'String' }], name: 'User' },
      ],
    })
    const path = resolved(resolve(definitions, 'B', 'owner.label'))
    expect(path).toMatchObject({
      eligibility: [],
      path: 'owner.label',
      terminal: { name: 'owner.label', type: 'String' },
      variants: [{ fields: [{ name: 'owner' }, { name: 'label' }] }],
    })
  })

  test('fails safely for ambiguous universal-root field contracts', () => {
    const ambiguous = load({
      entities: [
        { fields: [{ field: 'foo', type: 'Number' }], name: 'Left' },
        { fields: [{ field: 'foo', type: 'String' }], name: 'Right' },
      ],
    })
    const failure = resolve(ambiguous, 'Entity', 'foo')
    expect(failure).toMatchObject({
      contracts: expect.arrayContaining([
        'scalar:Number::required',
        'scalar:String::required',
      ]),
      entity: 'Entity',
      kind: 'ambiguous',
      path: 'foo',
    })

    const unambiguous = load({
      entities: [
        { fields: [{ field: 'foo', type: 'Number' }], name: 'Left' },
        { fields: [{ field: 'bar', type: 'String' }], name: 'Right' },
      ],
    })
    const path = resolved(resolve(unambiguous, 'Entity', 'foo'))
    expect(path).toMatchObject({
      eligibility: [{ entityTypes: ['Left'], occurrence: 0, path: 'entity' }],
      path: 'foo',
      terminal: { name: 'foo', type: 'Number' },
      variants: [{ fields: [{ name: 'foo', owner: 'Left' }] }],
    })
  })

  test('enforces the existing eight-hop reference limit', () => {
    const definitions = load({
      entities: [{
        fields: [
          { field: 'title', type: 'String' },
          { field: 'parent', target: 'Node', type: 'Entity' },
        ],
        name: 'Node',
      }],
    })
    const accepted = `${Array.from({ length: MAX_GRAPH_PATH_DEPTH }, () => 'parent').join('.')}.title`
    const rejected = `${Array.from({ length: MAX_GRAPH_PATH_DEPTH + 1 }, () => 'parent').join('.')}.title`
    expect(resolved(resolve(definitions, 'Node', accepted))).toMatchObject({
      path: accepted,
      terminal: { name: accepted, type: 'String' },
    })
    expect(resolve(definitions, 'Node', rejected)).toEqual({
      kind: 'depth',
      path: rejected,
    })
  })
})
