import { generateJSONSchemas, generateTypes } from 'basis/codegen'
import * as serverSurface from 'basis/server'
import { Graph } from 'basis/server'
import { withIsolatedDatabase } from 'basis/testing'
import { checksum } from 'basis/utilities'
import { generateErd } from 'basis/visualization'
import { expect, test } from 'bun:test'

const graph = new Graph({
  entities: [{
    fields: [{ field: 'id', format: 'UUID' }, { field: 'label', type: 'String' }],
    name: 'ConsumerNote',
  }],
})
const entities = graph.definitions

test('consumer fixture extends the system User ontology', () => {
  const application = new Graph({
    entities: [{ extends: 'User', fields: [], name: 'ApplicationUser' }],
  })
  expect(application.definitions.entity('ApplicationUser')).toBeTruthy()
  expect(application.definitions.entity('User')).toBeTruthy()
  expect('EntityDefinitions' in serverSurface).toBe(false)
  expect(checksum('basis')).toHaveLength(64)
})

test('consumer codegen and visualization surfaces resolve', () => {
  expect(generateTypes(graph)).toContain('export interface ConsumerNote')
  expect(generateJSONSchemas(graph).ConsumerNote?.output).toBeDefined()
  expect(generateErd(graph)).toContain('ConsumerNote')
})

test('consumer fixture uses provided entities', async () => {
  await withIsolatedDatabase('consumer-fixture', async database => {
    const id = '00000000-0000-4000-8000-000000000001'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${id}, 'Consumer', 'ConsumerNote')
    `
    await database.sql`
      INSERT INTO "ConsumerNote" ("id", "label")
      VALUES (${id}, 'isolated')
    `
    expect(await database.query('ConsumerNote', { fields: ['id', 'label'] }))
      .toEqual([{ id, label: 'isolated' }])
  }, { entities })
})
