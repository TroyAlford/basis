import { describe, expect, test } from 'bun:test'
import { Action, ADMIN_ROLE_ID, Graph, PUBLIC_ROLE_ID } from './Graph'
import { Operator } from './Operator'

const graph = new Graph({
  entities: [
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'owner', target: 'User', type: 'Entity' },
      ],
      name: 'Article',
    },
  ],
  grants: [
    { action: 'read', predicate: 'owner = $me', role: 'public', target: 'Article' },
    { action: 'update', predicate: 'owner = $me', role: 'editor', target: 'Article' },
    { action: 'manage', role: 'admin', target: '*' },
  ],
  roles: {
    editor: { name: 'Editor' },
  },
})

/**
 * Read the compiled identity-enrollment function.
 * @param model - Graph to inspect.
 * @returns Its enrollment SQL.
 */
function enrollSql(model: Graph): string {
  return model.physicalSchema('basis_app', false).functions
    .find(fn => fn.name === 'basis.enroll_identity')?.sql ?? ''
}

describe('Graph', () => {
  test('round-trips authored options through a JSON snapshot', () => {
    const original = new Graph({
      entities: [{ fields: [{ field: 'title', type: 'String' }], name: 'SnapshotNote' }],
      grants: [{ action: 'read', role: 'public', target: 'SnapshotNote' }],
      roles: { reader: { name: 'Reader' } },
    })
    const restored = new Graph(JSON.parse(JSON.stringify(original)))
    expect(restored.physicalSchema('basis_app', true))
      .toEqual(original.physicalSchema('basis_app', true))
  })

  test('compiles root grants from the canonical identity fields', () => {
    const rootGraph = new Graph({
      entities: [{ fields: [], name: 'Note' }],
      grants: [{ action: 'read', predicate: 'id = $me', role: 'public', target: 'Entity' }],
    })
    const read = rootGraph.physicalSchema('basis_app', true).policies.find(policy => (
      policy.table === 'Entity' && policy.command === 'SELECT'
    ))
    expect(read?.sql).toContain('basis.policy_')
    expect(read?.sql).toContain('"Entity"."entity"')
    expect(() => new Graph({
      entities: [{ fields: [{ field: 'name', type: 'String' }], name: 'Note' }],
    })).toThrow('reserved for the universal identity root')
  })

  test('constructs typed and JSON authoring equivalently', () => {
    const document = {
      entities: [
        {
          fields: [
            { field: 'email', type: 'String' },
            {
              cardinality: 'Many',
              field: 'notes',
              inverse: 'owner',
              target: 'Note',
              type: 'Inverse',
            },
          ],
          name: 'User',
        },
        {
          fields: [
            { field: 'title', type: 'String' },
            { field: 'owner', inverse: 'notes', target: 'User', type: 'Entity' },
          ],
          name: 'Note',
        },
      ],
    } as const
    const typed = new Graph({ entities: document })
    const json = new Graph({ entities: JSON.stringify(document) })
    expect(typed.definitions.physicalSchema())
      .toEqual(json.definitions.physicalSchema())
    expect(typed.roles).toEqual(json.roles)
    expect(typed.grants).toEqual(json.grants)
  })

  test('composes system ontology and application User overrides', () => {
    const plain = new Graph({ entities: [{ fields: [], name: 'Note' }] })
    expect(plain.definitions.entities.filter(entity => entity.name === 'User')).toHaveLength(1)
    expect(plain.definitions.entity('User')).toBeDefined()
    expect(plain.definitions.entity('Role')).toBeDefined()
    expect(plain.definitions.entity('ExternalIdentity')).toBeDefined()
    expect(plain.definitions.relationship('UserRole')).toBeDefined()

    const overridden = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
      ],
    })
    expect(overridden.definitions.entities.filter(entity => entity.name === 'User')).toHaveLength(1)
    expect(overridden.definitions.entity('User')?.abstract).toBe(true)
    expect(overridden.definitions.concreteDescendants('User').map(entity => entity.name))
      .toEqual(['AdminUser'])
    expect(overridden.definitions.isA('AdminUser', 'User')).toBe(true)
    expect(overridden.definitions.relationship('UserRole')?.between.map(endpoint => endpoint.target))
      .toContain('User')
    expect(enrollSql(plain)).toContain('INSERT INTO "User"')
    expect(enrollSql(overridden)).toContain('INSERT INTO "AdminUser"')
  })

  test('does not choose among multiple concrete User descendants', () => {
    const ambiguous = new Graph({
      entities: [
        { fields: [{ field: 'email', type: 'String' }], name: 'User' },
        { extends: 'User', fields: [], name: 'AdminUser' },
        { extends: 'User', fields: [], name: 'CustomerUser' },
      ],
    })
    const sql = enrollSql(ambiguous)
    expect(sql).toContain('FROM "ExternalIdentity"')
    expect(sql).toContain('RAISE EXCEPTION')
    expect(sql).toContain('multiple concrete User descendants: AdminUser, CustomerUser')
    expect(sql).not.toContain('INSERT INTO "AdminUser"')
    expect(sql).not.toContain('INSERT INTO "CustomerUser"')
  })

  test('validates the complete cross-fragment graph once', () => {
    const user = {
      fields: [{
        cardinality: 'Many',
        field: 'notes',
        inverse: 'owner',
        target: 'Note',
        type: 'Inverse',
      }],
      name: 'User',
    } as const
    const note = {
      fields: [{ field: 'owner', inverse: 'notes', target: 'User', type: 'Entity' }],
      name: 'Note',
    } as const
    const composed = new Graph({ entities: [user, note] })
    expect(composed.definitions.entity('User')?.inverseFields[0]?.name).toBe('notes')
    expect(composed.definitions.entity('Note')?.fields[1]?.name).toBe('owner')
    expect(() => new Graph({ entities: [user] })).toThrow('unknown target entity "Note"')
    expect(() => new Graph({ entities: [note] })).toThrow('no reciprocal Inverse field')
    expect(() => new Graph({ entities: [user, user, note] })).toThrow('duplicate entity "User"')
  })

  test('rejects duplicate system names', () => {
    expect(() => new Graph({ entities: [{ fields: [], name: 'Role' }] }))
      .toThrow('reserved by Basis authorization')
    expect(() => new Graph({ entities: [{ fields: [], name: 'ExternalIdentity' }] }))
      .toThrow('reserved by Basis authorization')
    expect(() => new Graph({ entities: [{ fields: [], name: 'UserRole' }] }))
      .toThrow('reserved by Basis authorization')
  })

  test('normalizes roles and $me into canonical graph data', () => {
    expect(graph.role('public')?.id).toBe(PUBLIC_ROLE_ID)
    expect(graph.role('admin')?.id).toBe(ADMIN_ROLE_ID)
    expect(graph.role('editor')?.name).toBe('Editor')
    expect(graph.grants[0]).toEqual({
      action: Action.Read,
      predicate: { field: 'owner.id', operator: Operator.Comparison.Equal, value: '$me' },
      role: PUBLIC_ROLE_ID,
      target: 'Article',
    })
  })

  test('compiles concrete SQL policies for every table and write check', () => {
    const schema = graph.physicalSchema('basis_app', true)
    expect(schema.tables.every(table => table.rowSecurity)).toBe(true)
    expect(schema.tables.every(table => table.forceRowSecurity)).toBe(true)
    const read = schema.policies.find(policy => policy.table === 'Article' && policy.command === 'SELECT')
    const update = schema.policies.find(policy => policy.table === 'Article' && policy.command === 'UPDATE')
    expect(read?.sql).toContain('current_setting(\'actor.id\', true)')
    expect(read?.sql).toContain('CREATE POLICY')
    expect(update?.sql).toContain('USING')
    expect(update?.sql).toContain('WITH CHECK')
    expect(schema.policies.some(policy => policy.table === 'Entity' && policy.command === 'SELECT')).toBe(true)
    expect(schema.policies.some(policy => policy.sql.includes('basis.matches'))).toBe(false)
    expect(schema.policies.some(policy => policy.sql.includes('authorized_row'))).toBe(false)
    expect(schema.functions.some(fn => fn.name === 'basis.has_role')).toBe(true)
    expect(schema.functions.some(fn => fn.name === 'basis.matches')).toBe(false)
    expect(schema.functions.some(fn => fn.name === 'basis.policy_field')).toBe(false)
  })
  test('normalizes and compiles named-relationship membership policies', () => {
    const membershipGraph = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      grants: [{
        action: 'read',
        predicate: "members $contains (id = $me $and workspaceMembership.role = 'Owner')",
        role: 'public',
        target: 'Workspace',
      }],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    })
    expect(membershipGraph.grants[0]?.predicate).toEqual({
      field: 'members',
      filters: [{
        filters: [
          { field: 'id', operator: Operator.Comparison.Equal, value: '$me' },
          { field: 'workspaceMembership.role', operator: Operator.Comparison.Equal, value: 'Owner' },
        ],
        operator: Operator.Logical.And,
      }],
      operator: Operator.Comparison.Contains,
    })
    const schema = membershipGraph.physicalSchema('basis_app', true)
    const helper = schema.functions.find(fn => fn.name.startsWith('basis.policy_'))
    expect(helper?.securityDefiner).toBe(true)
    expect(helper?.searchPath).toBe('public, basis, pg_temp')
    expect(helper?.sql).toContain('FROM "WorkspaceMembership" AS')
    expect(helper?.sql).toContain('"__policy_members_rel"."workspace.id" = "__row"."id"')
    expect(helper?.sql).toContain('"__policy_members_rel"."role"')
    expect(helper?.sql).toContain("current_setting('actor.id', true)")
    const policy = schema.policies.find(candidate => (
      candidate.table === 'Workspace' && candidate.command === 'SELECT'
    ))
    expect(policy?.sql).toContain(`basis.${helper?.name.split('.').at(-1)}`)
    expect(schema.grants.some(grant => grant.function === helper?.name && grant.kind === 'grant'))
      .toBe(true)
    expect(schema.grants.some(grant => grant.function === helper?.name && grant.kind === 'revoke'))
      .toBe(true)
  })

  test('normalizes structured and string membership predicates identically', () => {
    const source = 'members $contains (id = $me)'
    const entities = [
      { fields: [{ field: 'title', type: 'String' }], name: 'Workspace' },
      { fields: [], name: 'User' },
    ] as const
    const relationships = [{
      between: [
        { field: 'workspace', inverse: 'members', target: 'Workspace' },
        { field: 'user', inverse: 'workspaces', target: 'User' },
      ],
      fields: [{ field: 'role', type: 'String' }],
      name: 'WorkspaceMembership',
    }] as const
    const stringGraph = new Graph({
      entities,
      grants: [{ action: 'read', predicate: source, role: 'public', target: 'Workspace' }],
      relationships,
    })
    const structuredGraph = new Graph({
      entities,
      grants: [{
        action: 'read',
        predicate: {
          field: 'members',
          filters: [{ field: 'id', operator: '$eq', value: '$me' }],
          operator: '$contains',
        },
        role: 'public',
        target: 'Workspace',
      }],
      relationships,
    })
    expect(structuredGraph.grants).toEqual(stringGraph.grants)
    expect(structuredGraph.physicalSchema('basis_app', true).policies)
      .toEqual(stringGraph.physicalSchema('basis_app', true).policies)
  })

  test('supports inverse collection membership policies', () => {
    const inverseGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            { field: 'owner', inverse: 'articles', target: 'User', type: 'Entity' },
          ],
          name: 'Article',
        },
        {
          fields: [{
            cardinality: 'Many',
            field: 'articles',
            inverse: 'owner',
            target: 'Article',
            type: 'Inverse',
          }],
          name: 'User',
        },
      ],
      grants: [{
        action: 'read',
        predicate: 'articles $contains (id = $me)',
        role: 'public',
        target: 'User',
      }],
    })
    const helper = inverseGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('basis.policy_'))
    expect(helper?.sql).toContain('FROM "Article" AS')
    expect(helper?.sql).toContain('"owner.id"')
    expect(helper?.sql).toContain('current_setting(\'actor.id\', true)')
  })

  test('rejects unsupported authorization collection predicates', () => {
    const make = (predicate: string, action: 'read' | 'create' = 'read'): Graph => new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      grants: [{ action, predicate, role: 'public', target: 'Workspace' }],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    })
    expect(() => make('unknown $contains (id = $me)')).toThrow('Unknown collection or array navigation')
    expect(() => make("members $contains (workspaceMembership.missing = 'Owner')"))
      .toThrow('unknown relationship field')
    expect(() => make("members $contains [(id = $me), (workspaceMembership.role = 'Owner')]"))
      .toThrow('exactly one member requirement')
    expect(() => make('members $all (id = $me)')).toThrow('$all collection policy predicates')
    expect(() => make('members $contains (id = $me)', 'create'))
      .toThrow('create grants cannot use collection predicates')
    expect(() => make("members $contains (id = $me) $and members $contains (workspaceMembership.role = 'Owner')"))
      .toThrow('multiple $contains requirements')
  })

  test('supports collection $empty policies', () => {
    const emptyGraph = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      grants: [{
        action: 'read',
        predicate: 'members $empty',
        role: 'public',
        target: 'Workspace',
      }],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    })
    const helper = emptyGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('basis.policy_'))
    expect(helper?.sql).toContain('NOT EXISTS (SELECT 1 FROM "WorkspaceMembership" AS')
  })

  test('allows a single membership check combined with $empty', () => {
    const combined = new Graph({
      entities: [
        { fields: [], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      grants: [{
        action: 'read',
        predicate: 'members $empty $or members $contains (id = $me)',
        role: 'public',
        target: 'Workspace',
      }],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    })
    expect(combined.physicalSchema('basis_app', true).functions
      .some(fn => fn.name.startsWith('basis.policy_'))).toBe(true)
  })

  test('composes inherited membership and direct owner grants', () => {
    const composed = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Resource' },
        { extends: 'Resource', fields: [{ field: 'owner', target: 'User', type: 'Entity' }], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      grants: [
        { action: 'read', predicate: 'owner = $me', role: 'public', target: 'Workspace' },
        { action: 'read', predicate: 'members $contains (id = $me)', role: 'public', target: 'Resource' },
      ],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Resource' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    })
    const schema = composed.physicalSchema('basis_app', true)
    const helperNames = schema.functions
      .map(fn => fn.name)
      .filter(name => name.startsWith('basis.policy_'))
    expect(helperNames).toHaveLength(1)
    const policy = schema.policies.find(candidate => (
      candidate.table === 'Workspace' && candidate.command === 'SELECT'
    ))
    expect(policy?.sql).toContain('"Workspace"."owner.id"')
    expect(policy?.sql).toContain(`${helperNames[0]}("Workspace"."id")`)
    expect(policy?.sql).toContain(' OR ')
    expect(schema.functions.find(fn => fn.name === helperNames[0])?.sql)
      .toContain('FROM "Resource" AS "__row"')
  })

})
