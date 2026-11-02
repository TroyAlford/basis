import type { SQL } from 'bun'
import type { EntityDefinition, EntityDefinitions, EntityReferenceFieldDefinition, FieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType, isCanonicalSnowflake, isCanonicalUUID } from './EntityDefinitions'
import { normalizeScalar } from './ScalarNormalization'

/** A logical entity write payload keyed by canonical field names. */
export type EntityInput = Readonly<Record<string, unknown>>

/**
 * Create one complete concrete entity chain.
 *
 * The caller owns the transaction. `Database.create` supplies one; direct
 * callers must use it inside `db.tx` or another transaction-bound client.
 * @param sql - Transaction-bound SQL client.
 * @param definitions - Canonical entity definitions.
 * @param entityName - Concrete leaf entity name.
 * @param input - Logical field values plus root `displayName`.
 * @returns A promise that resolves after the complete chain is written.
 */
export async function createEntity(
  sql: SQL,
  definitions: EntityDefinitions,
  entityName: string,
  input: EntityInput,
): Promise<void> {
  const entity = requireConcrete(definitions, entityName)
  const chain = ancestry(definitions, entity)
  const key = primaryKeyField(entity)
  const keyValue = normalizeKey(key, required(input, key.name))
  requireString(required(input, 'displayName'), 'displayName')

  for (const name of Object.keys(input)) {
    if (name !== 'displayName' && !chain.some(part => part.fields.some(field => field.name === name))) {
      throw new Error(`Unknown field "${entityName}.${name}"`)
    }
  }

  await insert(sql, 'Entity', ['id', 'displayName', 'entity'], [
    keyValue,
    input.displayName,
    entityName,
  ])
  for (const part of chain) {
    const fields = part.fields
    await insert(
      sql,
      part.name,
      fields.map(field => columnName(field)),
      fields.map(field => normalizeValue(field, required(input, field.name))),
    )
  }
}

/**
 * Update one complete concrete entity chain.
 *
 * Only declared non-key fields and the root `displayName` may be changed.
 * @param sql - Transaction-bound SQL client.
 * @param definitions - Canonical entity definitions.
 * @param entityName - Concrete leaf entity name.
 * @param id - Shared identity value.
 * @param input - Logical field changes plus optional `displayName`.
 * @returns A promise that resolves after the complete chain is updated.
 */
export async function updateEntity(
  sql: SQL,
  definitions: EntityDefinitions,
  entityName: string,
  id: string,
  input: EntityInput,
): Promise<void> {
  const entity = requireConcrete(definitions, entityName)
  const chain = ancestry(definitions, entity)
  const key = primaryKeyField(entity)
  const keyValue = normalizeKey(key, id)
  await requireLeaf(sql, entityName, keyValue)

  const changes = Object.entries(input)
  if (changes.length === 0) throw new Error('No entity fields were provided for update')
  const fields = new Map(chain.flatMap(part => part.fields
    .filter(field => !(isScalar(field) && field.primaryKey))
    .map(field => [field.name, field] as const)))
  for (const [name, value] of changes) {
    if (value === undefined) throw new Error(`Field "${name}" must not be undefined`)
    if (name !== 'displayName' && !fields.has(name)) {
      throw new Error(`Unknown or immutable field "${entityName}.${name}"`)
    }
  }

  if (input.displayName !== undefined) {
    await sql.unsafe(
      'update "Entity" set "displayName" = $1 where "id" = $2',
      [requireString(input.displayName, 'displayName'), keyValue],
    )
  }
  for (const part of chain) {
    const updates = part.fields
      .filter(field => !(isScalar(field) && field.primaryKey) && input[field.name] !== undefined)
    if (updates.length === 0) continue
    const assignments = updates.map((field, index) => `${quote(columnName(field))} = $${index + 1}`)
    const values = updates.map(field => normalizeValue(field, input[field.name]))
    values.push(keyValue)
    await sql.unsafe(
      `update ${quote(part.name)} set ${assignments.join(', ')} where ${quote(key.name)} = $${values.length}`,
      values,
    )
  }
}

/**
 * Delete one complete concrete entity chain.
 * @param sql - Transaction-bound SQL client.
 * @param definitions - Canonical entity definitions.
 * @param entityName - Concrete leaf entity name.
 * @param id - Shared identity value.
 * @returns `true` when the root existed and was deleted.
 */
export async function deleteEntity(
  sql: SQL,
  definitions: EntityDefinitions,
  entityName: string,
  id: string,
): Promise<boolean> {
  const entity = requireConcrete(definitions, entityName)
  const chain = ancestry(definitions, entity)
  const key = primaryKeyField(entity)
  const keyValue = normalizeKey(key, id)
  if (!await leafExists(sql, entityName, keyValue)) return false

  for (const part of [...chain].reverse()) {
    await sql.unsafe(
      `delete from ${quote(part.name)} where ${quote(key.name)} = $1`,
      [keyValue],
    )
  }
  await sql.unsafe('delete from "Entity" where "id" = $1', [keyValue])
  return true
}

/**
 * Resolve one concrete entity or fail.
 * @param definitions - Canonical entity definitions.
 * @param name - Entity name.
 * @returns The concrete entity definition.
 */
function requireConcrete(
  definitions: EntityDefinitions,
  name: string,
): EntityDefinition {
  const entity = definitions.entity(name)
  if (!entity) throw new Error(`Unknown entity "${name}"`)
  if (entity.abstract) throw new Error(`Cannot instantiate abstract entity "${name}"`)
  return entity
}

/**
 * Resolve a root-to-leaf entity chain.
 * @param definitions - Canonical entity definitions.
 * @param leaf - Concrete leaf entity.
 * @returns Root-level ancestor through leaf.
 */
function ancestry(
  definitions: EntityDefinitions,
  leaf: EntityDefinition,
): readonly EntityDefinition[] {
  const chain: EntityDefinition[] = []
  let current: EntityDefinition | undefined = leaf
  while (current && current.name !== 'Entity') {
    chain.unshift(current)
    current = current.parent === 'Entity' ? undefined : definitions.entity(current.parent)
  }
  return chain
}

/**
 * Read a required input value.
 * @param input - Logical input record.
 * @param name - Logical field name.
 * @returns The supplied value.
 */
function required(input: EntityInput, name: string): unknown {
  if (!(name in input) || input[name] === undefined) {
    throw new Error(`Missing field "${name}"`)
  }
  return input[name]
}

/**
 * Validate and normalize one field value.
 * @param field - Logical field definition.
 * @param value - Raw input value.
 * @returns A database-ready value.
 */
function normalizeValue(field: FieldDefinition, value: unknown): unknown {
  if (field.type === FieldType.Entity) return normalizeReference(field, value)
  const normalized = normalizeScalar(field, value)
  if (normalized === undefined) throw invalidField(field)
  return normalized
}

/**
 * Validate one entity-reference identity value.
 * @param field - Reference field.
 * @param value - Raw identity value.
 * @returns Canonical text identity.
 */
function normalizeReference(field: EntityReferenceFieldDefinition, value: unknown): string {
  if (typeof value !== 'string') throw invalidField(field)
  if (field.targetType === FieldType.UUID && !isCanonicalUUID(value)) throw invalidField(field)
  if (field.targetType === FieldType.Snowflake && !isCanonicalSnowflake(value)) throw invalidField(field)
  return value
}

/**
 * Build one parameterized insert.
 * @param sql - Transaction-bound SQL client.
 * @param table - Physical table name.
 * @param columns - Physical columns.
 * @param values - Values in column order.
 * @returns A promise that resolves after the insert.
 */
async function insert(
  sql: SQL,
  table: string,
  columns: readonly string[],
  values: readonly unknown[],
): Promise<void> {
  const names = columns.map(quote).join(', ')
  const params = values.map((_, index) => `$${index + 1}`).join(', ')
  await sql.unsafe(`insert into ${quote(table)} (${names}) values (${params})`, [...values])
}

/**
 * Verify that a concrete leaf root exists with the expected discriminator.
 * @param sql - Transaction-bound SQL client.
 * @param entityName - Expected leaf entity.
 * @param id - Shared identity.
 * @returns A promise that rejects when absent or mismatched.
 */
async function requireLeaf(sql: SQL, entityName: string, id: string): Promise<void> {
  const rows = await sql<{ entity: string }[]>`
    select "entity" from "Entity" where "id" = ${id}
  `
  if (!rows[0]) throw new Error(`Entity "${entityName}" with id "${id}" was not found`)
  if (rows[0].entity !== entityName) {
    throw new Error(`Entity "${id}" is a "${rows[0].entity}", not "${entityName}"`)
  }
}

/**
 * Whether a concrete leaf root exists with the expected discriminator.
 * @param sql - Transaction-bound SQL client.
 * @param entityName - Expected leaf entity.
 * @param id - Shared identity.
 * @returns `true` when found.
 */
async function leafExists(sql: SQL, entityName: string, id: string): Promise<boolean> {
  const rows = await sql<{ entity: string }[]>`
    select "entity" from "Entity" where "id" = ${id}
  `
  if (!rows[0]) return false
  if (rows[0].entity !== entityName) {
    throw new Error(`Entity "${id}" is a "${rows[0].entity}", not "${entityName}"`)
  }
  return true
}

/**
 * Require a string value.
 * @param value - Raw value.
 * @param name - Input name for diagnostics.
 * @returns The string.
 */
function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Field "${name}" must be a string`)
  return value
}

/**
 * Whether a field is scalar.
 * @param field - Logical field.
 * @returns `true` for scalar fields.
 */
function isScalar(field: FieldDefinition): field is ScalarFieldDefinition {
  return field.type !== FieldType.Entity
}

/**
 * Resolve the primary-key field.
 * @param entity - Entity definition.
 * @returns Its scalar primary key.
 */
function primaryKeyField(entity: EntityDefinition): ScalarFieldDefinition {
  const field = entity.fields.find(
    (candidate): candidate is ScalarFieldDefinition => isScalar(candidate) && candidate.primaryKey,
  )
  if (!field) throw new Error(`Entity "${entity.name}" has no primary key`)
  return field
}

/**
 * Validate a shared identity key and return canonical text.
 * @param field - Primary-key field.
 * @param value - Raw identity.
 * @returns Canonical text identity.
 */
function normalizeKey(field: ScalarFieldDefinition, value: unknown): string {
  const normalized = normalizeValue(field, value)
  if (typeof normalized !== 'string') throw invalidField(field)
  return normalized
}

/**
 * Resolve a logical field's physical column name.
 * @param field - Logical field.
 * @returns Physical column name.
 */
function columnName(field: FieldDefinition): string {
  return field.type === FieldType.Entity ? field.column : field.name
}

/**
 * Quote a PostgreSQL identifier.
 * @param value - Identifier.
 * @returns The quoted identifier.
 */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Build a field validation error.
 * @param field - Invalid field.
 * @returns The error.
 */
function invalidField(field: FieldDefinition): Error {
  return new Error(`Invalid value for "${field.name}" as ${field.type}`)
}
