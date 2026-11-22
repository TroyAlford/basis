import { expect, test } from 'bun:test'
import { Action, Graph, Security } from './Graph'

const graph = new Graph({
  entities: [
    {
      fields: [],
      name: 'Workspace',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [{ field: 'active', type: 'Boolean' }],
      name: 'Card',
      security: { [Action.Read]: { where: 'active = true' } },
    },
    {
      extends: 'Card',
      fields: [],
      name: 'CustomCard',
    },
    {
      extends: 'Card',
      fields: [],
      name: 'OfficialCard',
    },
    {
      fields: [],
      name: 'Unrelated',
      security: { [Action.Read]: Security.Public },
    },
  ],
})

test('installs read policies on concrete leaves only', () => {
  const schema = graph.physicalSchema('basis_app', true)
  const read = (table: string) => schema.policies.find(policy => (
    policy.table === table && policy.command === 'SELECT'
  ))

  expect(schema.tables.find(table => table.name === 'Entity')?.rowSecurity).toBe(false)
  expect(schema.tables.find(table => table.name === 'Card')?.rowSecurity).toBe(false)
  expect(schema.tables.find(table => table.name === 'CustomCard')?.rowSecurity).toBe(true)
  expect(schema.tables.find(table => table.name === 'OfficialCard')?.rowSecurity).toBe(true)
  expect(read('Entity')).toBeUndefined()
  expect(read('Card')).toBeUndefined()
  for (const table of ['CustomCard', 'OfficialCard']) {
    const policy = read(table)?.sql ?? ''
    const helperName = /policy_[a-f0-9]+/.exec(policy)?.[0]
    const helper = schema.functions.find(fn => fn.name === helperName)
    expect(helper?.sql).toContain('active')
  }
  expect(read('Workspace')).toBeDefined()
  expect(read('Unrelated')).toBeDefined()
})

test('does not introduce a universal dispatcher or Graph-specific read function', () => {
  const schema = graph.physicalSchema('basis_app', true)
  expect(schema.functions.some(fn => fn.name === 'entity_readable')).toBe(false)
  expect(schema.policies.some(policy => policy.sql.includes('entity_readable'))).toBe(false)
})

test('preserves write policies while removing abstract read policies', () => {
  const schema = graph.physicalSchema('basis_app', true)
  expect(schema.policies.some(policy => policy.table === 'Card' && policy.command === 'SELECT')).toBe(false)
  expect(schema.policies.some(policy => policy.table === 'Card' && policy.command === 'INSERT')).toBe(true)
})
