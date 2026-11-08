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

describe('Graph', () => {
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
})
