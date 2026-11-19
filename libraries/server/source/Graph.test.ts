import { describe, expect, test } from 'bun:test'
import { Constraint } from './EntityDefinitions'
import { Action, ADMIN_ROLE_ID, Graph, PUBLIC_ROLE_ID, Security } from './Graph'
import { Operator } from './Operator'

const graph = new Graph({
  entities: [{
    fields: [
      { field: 'title', type: 'String' },
      { field: 'owner', target: 'User', type: 'Entity' },
    ],
    name: 'Article',
    security: {
      [Action.Read]: { where: 'owner = $me' },
      [Action.Update]: { role: 'editor', where: 'owner = $me' },
    },
  }],
  roles: {
    editor: { name: 'Editor' },
  },
})

describe('Graph', () => {
  test('round-trips authored options through a JSON snapshot', () => {
    const original = new Graph({
      entities: [{
        fields: [{ field: 'title', type: 'String' }],
        name: 'SnapshotNote',
        security: { [Action.Read]: Security.Public },
      }],
      roles: { reader: { name: 'Reader' } },
    })
    const restored = new Graph(JSON.parse(JSON.stringify(original)))
    expect(restored.physicalSchema('basis_app', true))
      .toEqual(original.physicalSchema('basis_app', true))
  })

  test('round-trips authored enum declarations through a JSON snapshot', () => {
    const original = new Graph({
      entities: [{
        fields: [{ enum: 'AccessLevel', field: 'access', type: 'Enum' }],
        name: 'SnapshotDocument',
      }],
      enums: {
        AccessLevel: {
          editor: 'Can edit resources.',
          viewer: 'Can view resources.',
        },
      },
    })
    const snapshot = JSON.parse(JSON.stringify(original))
    expect(snapshot.enums).toEqual({
      AccessLevel: { editor: 'Can edit resources.', viewer: 'Can view resources.' },
    })
    const restored = new Graph(snapshot)
    expect(restored.definitions.enums).toEqual(original.definitions.enums)
    expect(restored.physicalSchema('basis_app', true))
      .toEqual(original.physicalSchema('basis_app', true))
  })

  test('compiles root grants from the canonical identity fields', () => {
    const rootGraph = new Graph({
      entities: [{
        fields: [],
        name: 'Note',
        security: { [Action.Read]: { where: 'id = $me' } },
      }],
    })
    const read = rootGraph.physicalSchema('basis_app', true).policies.find(policy => (
      policy.table === 'Entity' && policy.command === 'SELECT'
    ))
    expect(read?.sql).toContain('public.policy_')
    expect(read?.sql).toContain('"Entity"."entity"')
    expect(() => new Graph({
      entities: [{ fields: [{ field: 'name', type: 'String' }], name: 'Note' }],
    })).toThrow('reserved for the universal identity root')
  })

  test('rejects incompatible descendant field contracts without policy or query access', () => {
    expect(() => new Graph({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'A' },
        { extends: 'A', fields: [{ field: 'foo', type: 'Number' }], name: 'B' },
        { extends: 'A', fields: [{ field: 'foo', type: 'String' }], name: 'C' },
      ],
    })).toThrow('incompatible field contract "foo" in hierarchy "A"')
  })

  test('accepts heterogeneous root id refinements at construction', () => {
    expect(() => new Graph({
      entities: [
        { fields: [], name: 'A' },
        { extends: 'A', fields: [{ field: 'id', format: 'UUID' }], name: 'B' },
        { extends: 'A', fields: [{ field: 'id', format: 'Snowflake' }], name: 'C' },
      ],
    })).not.toThrow()
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
    expect(update?.sql).toContain("basis.has_role('public',")
    expect(schema.functions.some(fn => fn.name === 'basis.has_role')).toBe(false)
    expect(schema.functions.some(fn => fn.name === 'basis.matches')).toBe(false)
    expect(schema.functions.some(fn => fn.name === 'policy_field')).toBe(false)
  })
  test('normalizes and compiles named-relationship membership policies', () => {
    const membershipGraph = new Graph({
      entities: [
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Workspace',
          security: {
            [Action.Read]: {
              where: "members $contains (id = $me $and workspaceMembership.role = 'Owner')",
            },
          },
        },
        { fields: [], name: 'User' },
      ],
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
    const helper = schema.functions.find(fn => fn.name.startsWith('policy_'))
    expect(helper?.securityDefiner).toBe(true)
    expect(helper?.searchPath).toBe('public, basis, pg_temp')
    expect(helper?.sql).toContain('FROM "WorkspaceMembership"')
    expect(helper?.sql).toContain('"__policy_0_members_rel"."workspace.id" = __row."id"')
    expect(helper?.sql).toContain('"__policy_0_members_rel"."role"')
    expect(helper?.sql).toContain("current_setting('actor.id', true)")
    const policy = schema.policies.find(candidate => (
      candidate.table === 'Workspace' && candidate.command === 'SELECT'
    ))
    expect(policy?.sql).toContain(`public.${helper?.name}`)
    expect(schema.grants.some(grant => grant.function === helper?.name && grant.kind === 'grant'))
      .toBe(true)
    expect(schema.grants.some(grant => grant.function === helper?.name && grant.kind === 'revoke'))
      .toBe(true)
  })

  test('normalizes structured and string membership predicates identically', () => {
    const source = 'members $contains (id = $me)'
    const relationships = [{
      between: [
        { field: 'workspace', inverse: 'members', target: 'Workspace' },
        { field: 'user', inverse: 'workspaces', target: 'User' },
      ],
      fields: [{ field: 'role', type: 'String' }],
      name: 'WorkspaceMembership',
    }] as const
    const withSecurity = (where: string | Readonly<Record<string, unknown>>) => [
      { fields: [{ field: 'title', type: 'String' }], name: 'Workspace', security: { [Action.Read]: { where } } },
      { fields: [], name: 'User' },
    ] as const
    const stringGraph = new Graph({
      entities: withSecurity(source),
      relationships,
    })
    const structuredGraph = new Graph({
      entities: withSecurity({
        field: 'members',
        filters: [{ field: 'id', operator: '$eq', value: '$me' }],
        operator: '$contains',
      }),
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
          security: { [Action.Read]: { where: 'articles $contains (id = $me)' } },
        },
      ],
    })
    const helper = inverseGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('policy_'))
    expect(helper?.sql).toContain('FROM "Article"')
    expect(helper?.sql).toContain('"owner.id"')
    expect(helper?.sql).toContain('current_setting(\'actor.id\', true)')
  })

  test('supports Entity-projected explicit collection membership policies', () => {
    const explicitGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            {
              field: 'cards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @].card',
            },
            {
              field: 'largeCards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 3].card',
            },
          ],
          name: 'Deck',
          security: { [Action.Read]: { where: 'largeCards $contains (id = $me)' } },
        },
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Card',
        },
        { fields: [], name: 'User' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    })
    const helper = explicitGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('policy_'))
    expect(helper?.sql).toContain('FROM "DeckCardPrinting"')
    expect(helper?.sql).toContain('"card.id"')
    expect(helper?.sql).toContain('"quantity" > 3')
    expect(helper?.sql).toContain('current_setting(\'actor.id\', true)')
  })

  test('supports record-projected explicit collection membership policies', () => {
    const recordGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            {
              field: 'entries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 0]',
            },
          ],
          name: 'Deck',
          security: {
            [Action.Read]: { where: 'entries $contains (card = $me $and quantity > 1)' },
          },
        },
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Card',
        },
        { fields: [], name: 'User' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    })
    const helper = recordGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('policy_'))
    expect(helper?.sql).toContain('FROM "DeckCardPrinting"')
    expect(helper?.sql).toContain('"card.id"')
    expect(helper?.sql).toContain('"quantity" > 0')
    expect(helper?.sql).toContain('"quantity" > 1')
    expect(helper?.sql).toContain('current_setting(\'actor.id\', true)')
  })

  test('supports Entity-projected relationship-owned policy predicates', () => {
    const accessGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            {
              field: 'members',
              target: 'User',
              type: 'Collection',
              via: 'WorkspaceAccess[workspace = @].user',
            },
          ],
          name: 'Workspace',
          security: {
            [Action.Read]: {
              where: 'members $contains (id = $me $and workspaceAccess.quantity > 4)',
            },
          },
        },
        { fields: [], name: 'User' },
        { fields: [], name: 'Scope' },
      ],
      relationships: [{
        between: [
          { field: 'workspace', target: 'Workspace' },
          { field: 'user', target: 'User' },
          { field: 'scope', target: 'Scope' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'WorkspaceAccess',
      }],
    })
    const helper = accessGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('policy_'))
    expect(helper?.sql).toContain('FROM "WorkspaceAccess"')
    expect(helper?.sql).toContain('"quantity" > 4')
    expect(helper?.sql).toContain('current_setting(\'actor.id\', true)')
  })

  test('rejects unsupported authorization collection predicates', () => {
    const make = (predicate: string, action: 'read' | 'create' = 'read'): Graph => new Graph({
      entities: [
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Workspace',
          security: { [action]: { where: predicate } },
        },
        { fields: [], name: 'User' },
      ],
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
      .not.toThrow()
    expect(() => make('members $all (id = $me)')).toThrow('$all collection policy predicates')
    expect(() => make('members $contains (id = $me)', 'create')).not.toThrow()
    expect(() => make("members $contains (id = $me) $and members $contains (workspaceMembership.role = 'Owner')"))
      .not.toThrow()
  })

  test('compiles create policies from proposed values and collection membership', () => {
    const membershipGraph = new Graph({
      entities: [
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Workspace',
          security: {
            [Action.Create]: { where: 'members $contains (id = $me)' },
            [Action.Read]: Security.Public,
          },
        },
        { fields: [], name: 'User' },
      ],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [],
        name: 'WorkspaceMembership',
      }],
    })
    const policy = membershipGraph.physicalSchema('basis_app', true).policies.find(candidate => (
      candidate.table === 'Workspace' && candidate.name === 'basis_Workspace_create'
    ))
    expect(policy?.sql).toContain('WITH CHECK')
    const helper = membershipGraph.physicalSchema('basis_app', true).functions
      .find(candidate => policy?.sql.includes(candidate.name))
    expect(helper?.sql).toContain('WorkspaceMembership')
    expect(helper?.sql).toContain('current_setting')
  })

  test('supports collection $empty policies', () => {
    const emptyGraph = new Graph({
      entities: [
        {
          fields: [{ field: 'title', type: 'String' }],
          name: 'Workspace',
          security: { [Action.Read]: { where: 'members $empty' } },
        },
        { fields: [], name: 'User' },
      ],
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
      .find(fn => fn.name.startsWith('policy_'))
    expect(helper?.sql).toContain('NOT EXISTS (SELECT 1 FROM "WorkspaceMembership"')
  })

  test('allows a single membership check combined with $empty', () => {
    const combined = new Graph({
      entities: [
        {
          fields: [],
          name: 'Workspace',
          security: {
            [Action.Read]: { where: 'members $empty $or members $contains (id = $me)' },
          },
        },
        { fields: [], name: 'User' },
      ],
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
      .some(fn => fn.name.startsWith('policy_'))).toBe(true)
  })

  test('composes inherited membership and direct owner grants', () => {
    const composed = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Resource' },
        {
          extends: 'Resource',
          fields: [{ field: 'owner', target: 'User', type: 'Entity' }],
          name: 'Workspace',
          security: {
            [Action.Read]: [
              { where: 'owner = $me' },
              { where: 'members $contains (id = $me)' },
            ],
          },
        },
        { fields: [], name: 'User' },
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
      .filter(name => name.startsWith('policy_'))
    expect(helperNames).toHaveLength(1)
    const policy = schema.policies.find(candidate => (
      candidate.table === 'Workspace' && candidate.command === 'SELECT'
    ))
    expect(policy?.sql).toContain(`public.${helperNames[0]}("Workspace"."id")`)
    expect(policy?.sql).toContain('"Workspace"."owner.id"')
    expect(schema.functions.find(fn => fn.name === helperNames[0])?.sql)
      .toContain('"WorkspaceMembership"')
  })

  test('compiles named capabilities and entity security into one policy authority', () => {
    enum Capability {
      Manage = 'manageCampaigns',
      View = 'viewCampaigns',
    }
    enum MembershipRole {
      Owner = 'Owner',
      Viewer = 'Viewer',
    }
    const security = {
      [Action.Read]: [
        { grant: Capability.Manage },
        {
          grant: Capability.View,
          where: {
            field: 'members',
            filters: [{
              filters: [
                { field: 'id', operator: Operator.Comparison.Equal, value: '$me' },
                {
                  field: 'workspaceMembership.role',
                  operator: Operator.Comparison.Equal,
                  value: MembershipRole.Owner,
                },
              ],
              operator: Operator.Logical.And,
            }],
            operator: Operator.Comparison.Contains,
          },
        },
      ],
      [Action.Update]: { grant: Capability.Manage },
    }
    const capabilityGraph = new Graph({
      entities: [
        { fields: [{ field: 'title', type: 'String' }], name: 'Workspace', security },
        { fields: [], name: 'User' },
      ],
      grants: {
        [Capability.Manage]: { description: 'Manage campaigns' },
        [Capability.View]: { description: 'View campaigns' },
      },
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
      roles: {
        owner: { grants: [Capability.View, Capability.Manage], name: 'Owner group' },
        viewer: { grants: [Capability.View], name: 'Viewer group' },
      },
    } as never)
    expect(capabilityGraph.capabilities).toEqual([
      { description: 'Manage campaigns', name: Capability.Manage },
      { description: 'View campaigns', name: Capability.View },
    ])
    expect(capabilityGraph.roles.find(role => role.name === 'Owner group')?.grants)
      .toEqual([Capability.View, Capability.Manage])
    expect(capabilityGraph.security).toMatchObject([
      { action: Action.Read, owner: 'Workspace' },
      { action: Action.Update, owner: 'Workspace' },
    ])
    const readGrants = capabilityGraph.grants.filter(grant => grant.action === Action.Read)
    expect(readGrants).toHaveLength(3)
    const schema = capabilityGraph.physicalSchema('basis_app', true)
    const read = schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'SELECT')
    const update = schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'UPDATE')
    const create = schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'INSERT')
    const remove = schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'DELETE')
    expect(read?.sql).toContain('basis.has_role')
    expect(read?.sql).toContain('public.policy_')
    expect(update?.sql).toContain('basis.has_role')
    expect(update?.sql).toContain('public.policy_')
    expect(create?.sql).toContain('FALSE')
    expect(remove?.sql).toContain('FALSE')
  })

  test('supports explicit public security without implicit writes', () => {
    const publicGraph = new Graph({
      entities: [{
        fields: [{ field: 'title', type: 'String' }],
        name: 'Workspace',
        security: { [Action.Read]: Security.Public },
      }],
    } as never)
    const schema = publicGraph.physicalSchema('basis_app', true)
    expect(schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'SELECT')?.sql)
      .toContain('TRUE')
    expect(schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'UPDATE')?.sql)
      .toContain('FALSE')
    expect(schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'INSERT')?.sql)
      .toContain('FALSE')
    expect(schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'DELETE')?.sql)
      .toContain('FALSE')
  })

  test('requires read for every write and rejects security on an inherited pair', () => {
    const writeOnly = new Graph({
      entities: [{
        fields: [{ field: 'title', type: 'String' }],
        name: 'Workspace',
        security: { [Action.Update]: Security.Public },
      }],
    } as never)
    expect(writeOnly.accessExpression('update', 'Workspace', { id: 'row' })).toBeNull()
    expect(() => new Graph({
      entities: [
        {
          fields: [],
          name: 'Resource',
          security: { [Action.Read]: Security.Public },
        },
        {
          extends: 'Resource',
          fields: [],
          name: 'Workspace',
          security: { [Action.Update]: Security.Public },
        },
      ],
    } as never)).toThrow('security is declared on both "Resource" and "Workspace"')
    expect(() => new Graph({
      entities: [
        { fields: [], name: 'Resource', security: { [Action.Read]: Security.Public } },
        { extends: 'Resource', fields: [], name: 'Workspace' },
        { extends: 'Workspace', fields: [], name: 'Room', security: { [Action.Delete]: Security.Public } },
      ],
    } as never)).toThrow('security is declared on both "Resource" and "Room"')
  })

  test('inherits a single parent security contract through descendants', () => {
    const inherited = new Graph({
      entities: [
        {
          fields: [],
          name: 'Resource',
          security: { [Action.Read]: Security.Public },
        },
        { extends: 'Resource', fields: [], name: 'Workspace' },
        { extends: 'Workspace', fields: [], name: 'Room' },
      ],
    } as never)
    const schema = inherited.physicalSchema('basis_app', true)
    expect(schema.policies.find(policy => policy.table === 'Workspace' && policy.command === 'SELECT')?.sql)
      .toContain('TRUE')
    expect(schema.policies.find(policy => policy.table === 'Room' && policy.command === 'SELECT')?.sql)
      .toContain('TRUE')
  })

  test('allows sibling security when no ancestor declares security', () => {
    const siblings = new Graph({
      entities: [
        { fields: [], name: 'Resource' },
        {
          extends: 'Resource',
          fields: [],
          name: 'Workspace',
          security: { [Action.Read]: Security.Public },
        },
        {
          extends: 'Resource',
          fields: [],
          name: 'Folder',
          security: { [Action.Read]: Security.Public },
        },
      ],
    } as never)
    expect(siblings.security).toHaveLength(2)
  })

  test('compiles explicit actor-presence policies without implicit grants', () => {
    const authenticated = new Graph({
      entities: [{
        fields: [],
        name: 'Note',
        security: { [Action.Read]: { where: '$me != null' } },
      }],
    })
    const read = authenticated.physicalSchema('basis_app', true).policies.find(policy => (
      policy.table === 'Note' && policy.command === 'SELECT'
    ))
    expect(read?.sql).toContain('current_setting(\'actor.id\', true)')
    expect(read?.sql).toContain('NOT COALESCE')
    const anonymous = new Graph({
      entities: [{ fields: [], name: 'Note' }],
    })
    expect(anonymous.physicalSchema('basis_app', true).policies
      .filter(policy => !['Entity', 'User', 'Role', 'ExternalIdentity', 'UserRole'].includes(policy.table))
      .every(policy => policy.sql.includes('FALSE'))).toBe(true)
  })

  test('compiles nested collection and composed reference policy predicates', () => {
    const nested = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            {
              cardinality: 'Many',
              field: 'projects',
              inverse: 'workspace',
              target: 'Project',
              type: 'Inverse',
            },
          ],
          name: 'Workspace',
          security: {
            [Action.Read]: {
              where: "$me != null $and projects $contains (title = 'visible' AND tasks $contains (title = 'open'))",
            },
          },
        },
        {
          fields: [
            { field: 'title', type: 'String' },
            { field: 'workspace', inverse: 'projects', target: 'Workspace', type: 'Entity' },
            {
              cardinality: 'Many',
              field: 'tasks',
              inverse: 'project',
              target: 'Task',
              type: 'Inverse',
            },
          ],
          name: 'Project',
        },
        {
          fields: [
            { field: 'title', type: 'String' },
            { field: 'project', inverse: 'tasks', target: 'Project', type: 'Entity' },
          ],
          name: 'Task',
          security: { [Action.Read]: { where: 'project.workspace.members $contains (id = $me)' } },
        },
        { fields: [], name: 'User' },
      ],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [],
        name: 'WorkspaceMembership',
      }],
    })
    const helpers = nested.physicalSchema('basis_app', true).functions
      .filter(fn => fn.name.startsWith('policy_'))
      .map(fn => fn.sql)
      .join('\n')
    expect(helpers.match(/EXISTS \(SELECT 1 FROM "Project"/gu)).toHaveLength(1)
    expect(helpers.match(/EXISTS \(SELECT 1 FROM "Task"/gu)).toHaveLength(1)
    expect(helpers).toContain('"project.id" = ')
    expect(helpers).toContain('"workspace.id" = ')
    expect(helpers).toContain('current_setting(\'actor.id\', true)')
  })

  test('allows where-only membership rules without an artificial capability', () => {
    enum MembershipRole {
      Owner = 'Owner',
    }
    const whereOnly = new Graph({
      entities: [{
        fields: [],
        name: 'Workspace',
        security: {
          [Action.Read]: {
            where: {
              field: 'members',
              filters: [{
                filters: [
                  { field: 'id', operator: Operator.Comparison.Equal, value: '$me' },
                  {
                    field: 'workspaceMembership.role',
                    operator: Operator.Comparison.Equal,
                    value: MembershipRole.Owner,
                  },
                ],
                operator: Operator.Logical.And,
              }],
              operator: Operator.Comparison.Contains,
            },
          },
        },
      }, { fields: [], name: 'User' }],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
      }],
    } as never)
    expect(whereOnly.security[0]?.rules).toEqual([{ where: expect.objectContaining({ field: 'members' }) }])
    expect(whereOnly.grants).toMatchObject([{
      action: Action.Read,
      role: PUBLIC_ROLE_ID,
      target: 'Workspace',
    }])
    const read = whereOnly.physicalSchema('basis_app', true).policies.find(policy => (
      policy.table === 'Workspace' && policy.command === 'SELECT'
    ))
    expect(read?.sql).toContain('public.policy_')
    expect(read?.sql).not.toContain('FALSE')
  })

  test('applies explicit public security to named relationship tables', () => {
    const relationshipSecurity = new Graph({
      entities: [
        { fields: [], name: 'Workspace' },
        { fields: [], name: 'User' },
      ],
      relationships: [{
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
        security: { [Action.Read]: Security.Public },
      }],
    } as never)
    const schema = relationshipSecurity.physicalSchema('basis_app', true)
    expect(schema.policies.find(policy => (
      policy.table === 'WorkspaceMembership' && policy.command === 'SELECT'
    ))?.sql).toContain('TRUE')
  })

  test('rejects unknown capabilities, roles, and actions in security declarations', () => {
    const base = {
      grants: { Known: { description: 'Known' } },
      roles: { viewer: { grants: ['Known'], name: 'Viewer' } },
    }
    const make = (security: unknown): Graph => new Graph({
      ...base,
      entities: [{ fields: [], name: 'Workspace', security }],
    } as never)
    expect(() => make({ read: { grant: 'Missing' } })).toThrow('unknown capability "Missing"')
    expect(() => make({ read: { role: 'Missing' } })).toThrow('unknown role "Missing"')
    expect(() => make({ read: { role: 'public' } })).toThrow('must use Security.Public')
    expect(() => make({ read: { where: 'members $contains (id = $me)' } }))
      .toThrow('Unknown collection or array navigation')
    expect(() => make({ invalid: Security.Public })).toThrow('unknown action "invalid"')
    expect(() => make({ read: {} })).toThrow('must declare grant, role, or a non-empty where')
    expect(() => make({ read: { where: null } })).toThrow('must declare grant, role, or a non-empty where')
  })

  test('compiles relationship policy helpers against composite endpoint columns', () => {
    const relationshipGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'title', type: 'String' },
            {
              field: 'members',
              target: 'User',
              type: 'Collection',
              via: 'Membership[workspace = @].user',
            },
          ],
          name: 'Workspace',
        },
        { fields: [], name: 'User' },
        { fields: [], name: 'Item' },
      ],
      relationships: [
        {
          between: [
            { field: 'workspace', target: 'Workspace' },
            { field: 'user', target: 'User' },
          ],
          fields: [{ field: 'role', type: 'String' }],
          name: 'Membership',
        },
        {
          between: [
            { field: 'workspace', target: 'Workspace' },
            { field: 'item', target: 'Item' },
          ],
          fields: [],
          name: 'ItemAccess',
        },
      ],
      security: {
        ItemAccess: {
          [Action.Read]: { where: 'workspace.members $contains (id = $me)' },
        },
      },
    })
    const helper = relationshipGraph.physicalSchema('basis_app', true).functions
      .find(fn => fn.name.startsWith('policy_') && fn.sql.includes('ItemAccess'))
    expect(helper?.signature).toBe('workspaceId text, itemId text')
    expect(helper?.sql).toContain('"__row"."workspace.id" = workspaceId')
    expect(helper?.sql).toContain('"__row"."item.id" = itemId')
    expect(helper?.sql).not.toMatch(/"__row"\."id"/u)
  })

  test('uses a body-safe dollar delimiter for generated helpers', () => {
    const payload = 'Safe $$ \' OR TRUE; DROP TABLE "Workspace"; --'
    const quoted = payload.replaceAll("'", "\\'")
    const delimiterGraph = new Graph({
      entities: [{
        constraints: [{
          description: 'Title excludes the reserved payload.',
          name: 'reservedTitle',
          type: Constraint.Validation,
          where: `title != '${quoted}'`,
        }],
        fields: [{ field: 'title', type: 'String' }],
        name: 'Workspace',
        security: {
          [Action.Create]: { where: `title = '${quoted}'` },
          [Action.Read]: { where: `title = '${quoted}'` },
        },
      }],
    })
    const functions = delimiterGraph.physicalSchema('basis_app', true).functions
    const generated = functions.filter(fn => fn.securityDefiner)
    expect(generated.length).toBeGreaterThanOrEqual(2)
    for (const fn of generated) {
      expect(fn.sql).not.toMatch(/\bAS \$\$/u)
      expect(fn.sql).toMatch(/AS \$basis(?:_\d+)?\$/u)
      expect(fn.body).toContain('$$')
    }
  })

})
