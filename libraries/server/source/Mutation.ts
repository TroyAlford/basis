import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import type { ArrayFieldDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, ScalarArrayElementDefinition } from './EntityDefinitions'
import { FieldType, isCanonicalSnowflake, isCanonicalUUID } from './EntityDefinitions'
import { compilePolymorphicQuery } from './PolymorphicQuery'
import { postgresScalarType } from './PostgresTypes'
import type { Filter } from './Predicate'

/** Maximum records accepted by one bulk mutation. */
export const MAX_MUTATION_BATCH = 1_000

/** Stable mutation failure categories. */
export type MutationErrorCode =
  | 'authorization'
  | 'cardinality'
  | 'constraint'
  | 'filter'
  | 'infrastructure'
  | 'operation'
  | 'validation'

/** One stable, payload-rooted mutation failure. */
export class MutationError extends Error {
  /** Stable machine-readable failure category. */
  readonly code: MutationErrorCode
  /** JSON Pointer rooted in the submitted payload, when one field caused the failure. */
  readonly path?: string

  /**
   * Create a mutation failure.
   * @param code - Stable failure category.
   * @param message - Actionable diagnostic.
   * @param options - Optional payload path and cause.
   * @param options.cause - Underlying failure.
   * @param options.path - JSON Pointer rooted in the submitted payload.
   */
  constructor(
    code: MutationErrorCode,
    message: string,
    options: { readonly cause?: unknown, readonly path?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MutationError'
    this.code = code
    if (options.path !== undefined) this.path = options.path
  }
}

/** Result of a create operation. */
export interface CreateResult {
  /** Number of entities created. */
  readonly created: number,
}

/** Result of an edit operation. */
export interface EditResult {
  /** Number of entities edited. */
  readonly edited: number,
}

/** Result of a delete operation. */
export interface DeleteResult {
  /** Number of entities deleted. */
  readonly deleted: number,
}

/** Result of an upsert operation. */
export interface UpsertResult {
  /** `1` when the create branch ran, otherwise `0`. */
  readonly created: number,
  /** `1` when the edit branch ran, otherwise `0`. */
  readonly edited: number,
}

/** The Graph-native mutation vocabulary. */
export interface MutationDatabase {
  /**
   * Create one entity or a finite synchronous batch atomically.
   * @param entity - Exact concrete entity name.
   * @param values - One value object or a finite iterable of value objects.
   * @returns The created count.
   */
  create(
    entity: string,
    values: MutationValues | Iterable<MutationValues>,
  ): Promise<CreateResult>,
  /**
   * Delete every actor-authorized entity selected by the filter.
   * @param entity - Exact entity or abstract ancestor name.
   * @param filter - Existing string, structured, or shorthand filter.
   * @returns The deleted count.
   */
  delete(
    entity: string,
    filter: MutationFilter,
  ): Promise<DeleteResult>,
  /**
   * Patch every actor-authorized entity selected by the filter.
   * @param entity - Exact entity or abstract ancestor name.
   * @param filter - Existing string, structured, or shorthand filter.
   * @param changes - Field values to patch.
   * @returns The edited count.
   */
  edit(
    entity: string,
    filter: MutationFilter,
    changes: MutationValues,
  ): Promise<EditResult>,
  /**
   * Edit exactly one authorized match, or create when none is visible to the actor.
   * @param entity - Exact concrete entity name.
   * @param filter - Existing string, structured, or shorthand filter.
   * @param values - Values used by the edit or create branch.
   * @returns Which branch ran.
   */
  upsert(
    entity: string,
    filter: MutationFilter,
    values: MutationValues,
  ): Promise<UpsertResult>,
}

/** One plain mutation value record. */
export type MutationValues = Readonly<Record<string, unknown>>
/** Existing canonical filter forms accepted by the read compiler. */
export type MutationFilter = Filter | Readonly<Record<string, unknown>> | string

/** One frozen selected root identity. */
interface SelectedIdentity {
  /** Concrete entity discriminator. */
  readonly entity: string,
  /** Canonical root identity. */
  readonly id: string,
}

/** One prepared create value. */
interface PreparedCreate {
  /** Canonical identity. */
  readonly id: string,
  /** Submitted values. */
  readonly values: MutationValues,
}

/** Generated write expression and its ordered bindings. */
interface WriteStatement {
  /** SQL text with `$1`, `$2`, … placeholders. */
  readonly sql: string,
  /** Ordered bindings. */
  readonly values: readonly unknown[],
}

/** Keyword arguments used by one mutation owner. */
interface MutationOptions {
  /** Canonical entity definitions. */
  readonly entities: EntityDefinitions,
  /** Transaction-scoped Bun SQL client. */
  readonly sql: BunSQL,
}

/** Fields generated by the root or update tracking, never writable. */
const READONLY_FIELDS = new Set(['entity', 'lastUpdatedAt', 'lastUpdatedBy'])
/** Edit and upsert-edit fields that must never change. */
const EDIT_READONLY_FIELDS = new Set(['entity', 'id', 'lastUpdatedAt', 'lastUpdatedBy'])

/**
 * Build the mutation capability bound to one SQL connection.
 *
 * `Database.tx` calls this with its native transaction client, so mutations and
 * caller SQL share exactly one PostgreSQL transaction and actor setting.
 * @param entities - Canonical entity definitions.
 * @param sql - Transaction-scoped SQL client.
 * @returns The Graph-native mutation vocabulary.
 */
export function mutationRunner(entities: EntityDefinitions, sql: BunSQL): MutationDatabase {
  return {
    create: (entity, values) => create({ entities, sql }, entity, values),
    delete: (entity, filter) => remove({ entities, sql }, entity, filter),
    edit: (entity, filter, changes) => edit({ entities, sql }, entity, filter, changes),
    upsert: (entity, filter, values) => upsert({ entities, sql }, entity, filter, values),
  }
}

/**
 * Create one entity or a finite synchronous batch atomically.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param entity - Exact concrete entity name.
 * @param input - One value object or a finite iterable.
 * @returns The created count.
 */
async function create(
  { entities, sql }: MutationOptions,
  entity: string,
  input: MutationValues | Iterable<MutationValues>,
): Promise<CreateResult> {
  const definition = requireConcrete(entities, entity)
  const values = materialize(input)
  const prepared = values.map((value, index) => prepareCreate(definition, value, index))
  for (const item of prepared) await insert(entities, sql, definition, item)
  return { created: prepared.length }
}

/**
 * Patch every authorized entity selected by the filter.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param entity - Entity or abstract ancestor name.
 * @param filter - Existing filter form.
 * @param changes - Field values to patch.
 * @returns The edited count.
 */
async function edit(
  { entities, sql }: MutationOptions,
  entity: string,
  filter: MutationFilter,
  changes: MutationValues,
): Promise<EditResult> {
  const definition = requireEntity(entities, entity)
  const normalized = prepareChanges(entities, definition, changes, '/changes')
  const matches = await selectMatches({ entities, sql }, definition, filter)
  const edited = await applyEdit({ entities, sql }, definition, matches, normalized)
  return { edited }
}

/**
 * Delete every authorized entity selected by the filter.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param entity - Entity or abstract ancestor name.
 * @param filter - Existing filter form.
 * @returns The deleted count.
 */
async function remove(
  { entities, sql }: MutationOptions,
  entity: string,
  filter: MutationFilter,
): Promise<DeleteResult> {
  const definition = requireEntity(entities, entity)
  const matches = await selectMatches({ entities, sql }, definition, filter)
  let deleted = 0
  for (const [leaf, identities] of groupByIdentity(matches)) {
    const ids = identities.map(identity => identity.id)
    const ancestry = entities.ancestry(leaf).slice(1).filter(table => table !== 'Entity')
    deleted += (await deleteChain(sql, leaf, ancestry, ids)).length
  }
  return { deleted }
}

/**
 * Edit one authorized match, or create when no match is mutable by the actor.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param entity - Exact concrete entity name.
 * @param filter - Existing filter form.
 * @param values - Values used by either branch.
 * @returns Which branch ran.
 */
async function upsert(
  { entities, sql }: MutationOptions,
  entity: string,
  filter: MutationFilter,
  values: MutationValues,
): Promise<UpsertResult> {
  const definition = requireConcrete(entities, entity)
  await lockFilter(sql, entity, filter)
  const matches = await selectMatches({ entities, sql }, definition, filter)
  if (matches.length === 0) {
    const item = prepareCreate(definition, values, 0)
    await insert(entities, sql, definition, item)
    return { created: 1, edited: 0 }
  }

  const mutable = await authorizeEdit({ entities, sql }, definition, matches)
  if (mutable.length === 0) {
    const item = prepareCreate(definition, values, 0)
    await insert(entities, sql, definition, item)
    return { created: 1, edited: 0 }
  }
  if (mutable.length > 1) {
    throw new MutationError(
      'cardinality',
      `Upsert selected ${mutable.length} mutable entities; exactly one is required`,
    )
  }
  const changes = prepareChanges(entities, definition, values, '/values')
  await applyChanges({ entities, sql }, definition, mutable, changes)
  return { created: 0, edited: 1 }
}

/**
 * Apply one edit to already-selected identities.
 * @param options - Canonical definitions and transaction client.
 * @param definition - Entity or abstract ancestor.
 * @param matches - Selected identities.
 * @param changes - Normalized field patches.
 * @returns The number of root rows PostgreSQL allowed to update.
 */
async function applyEdit(
  options: MutationOptions,
  definition: EntityDefinition,
  matches: readonly SelectedIdentity[],
  changes: ReadonlyMap<string, unknown>,
): Promise<number> {
  if (matches.length === 0) return 0
  const mutable = await authorizeEdit(options, definition, matches)
  await applyChanges(options, definition, mutable, changes)
  return mutable.length
}

/**
 * Apply a root update to establish write authorization and freeze the mutable set.
 * @param options - Canonical definitions and transaction client.
 * @param options.sql - Transaction-scoped SQL client.
 * @param definition - Entity or abstract ancestor.
 * @param matches - Selected identities.
 * @returns The root identities PostgreSQL allowed to update.
 */
async function authorizeEdit(
  { sql }: MutationOptions,
  definition: EntityDefinition,
  matches: readonly SelectedIdentity[],
): Promise<readonly SelectedIdentity[]> {
  const ids = matches.map(match => match.id)
  const rows = await writeIds(definition, sql, 'Entity', ids, new Map())
  const allowed = new Set(rows)
  return matches.filter(match => allowed.has(match.id))
}

/**
 * Apply normalized changes to owner tables for the mutable identities.
 * @param options - Canonical definitions and transaction client.
 * @param options.sql - Transaction-scoped SQL client.
 * @param definition - Entity or abstract ancestor.
 * @param matches - Mutable identities.
 * @param changes - Normalized field patches.
 */
async function applyChanges(
  { sql }: MutationOptions,
  definition: EntityDefinition,
  matches: readonly SelectedIdentity[],
  changes: ReadonlyMap<string, unknown>,
): Promise<void> {
  if (matches.length === 0) return
  const byOwner = new Map<string, Map<string, unknown>>()
  for (const [name, value] of changes) {
    const field = findField(definition, name)
    const owner = field.owner
    const ownerChanges = byOwner.get(owner) ?? new Map<string, unknown>()
    ownerChanges.set(name, value)
    byOwner.set(owner, ownerChanges)
  }
  const ids = matches.map(match => match.id)
  for (const [owner, ownerChanges] of byOwner) {
    await writeIds(definition, sql, owner, ids, ownerChanges)
  }
}

/**
 * Prepare and validate one create value.
 * @param definition - Concrete target entity.
 * @param input - Submitted value.
 * @param index - Batch index for payload-rooted diagnostics.
 * @returns The prepared create value.
 */
function prepareCreate(
  definition: EntityDefinition,
  input: MutationValues,
  index: number,
): PreparedCreate {
  const base = `/values/${index}`
  if (!isPlainRecord(input)) {
    throw new MutationError('validation', 'Create values must be plain objects', { path: base })
  }
  const values: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(input)) {
    if (READONLY_FIELDS.has(name)) {
      throw new MutationError(
        'validation',
        `Field "${name}" is generated and cannot be written`,
        { path: `${base}/${pointer(name)}` },
      )
    }
    if (name === 'id') {
      values.id = validateIdentity(definition, value, `${base}/id`)
      continue
    }
    const field = definition.effectiveFields.find(candidate => candidate.name === name)
    if (!field) {
      throw new MutationError('validation', `Unknown field "${name}" on ${definition.name}`, {
        path: `${base}/${pointer(name)}`,
      })
    }
    values[name] = validateValue(definition, field, value, `${base}/${pointer(name)}`)
  }

  const id = values.id === undefined ? generateIdentity(definition, `${base}/id`) : String(values.id)
  for (const field of definition.effectiveFields) {
    if (requiredField(field) && !Object.hasOwn(values, field.name)) {
      throw new MutationError(
        'validation',
        `Field "${field.name}" is required`,
        { path: `${base}/${pointer(field.name)}` },
      )
    }
  }
  return { id, values }
}

/**
 * Prepare and validate edit changes.
 * @param entities - Canonical definitions.
 * @param definition - Entity or abstract ancestor.
 * @param input - Submitted changes.
 * @param base - Payload-rooted JSON Pointer.
 * @returns Normalized changes by logical field name.
 */
function prepareChanges(
  entities: EntityDefinitions,
  definition: EntityDefinition,
  input: MutationValues,
  base: string,
): ReadonlyMap<string, unknown> {
  if (!isPlainRecord(input)) {
    throw new MutationError('validation', 'Changes must be a plain object', { path: base })
  }
  const changes = new Map<string, unknown>()
  for (const [name, value] of Object.entries(input)) {
    if (EDIT_READONLY_FIELDS.has(name)) {
      throw new MutationError(
        'validation',
        `Field "${name}" is readonly and cannot be written`,
        { path: `${base}/${pointer(name)}` },
      )
    }
    const field = definition.effectiveFields.find(candidate => candidate.name === name)
    if (!field) {
      throw new MutationError('validation', `Unknown field "${name}" on ${definition.name}`, {
        path: `${base}/${pointer(name)}`,
      })
    }
    changes.set(name, validateValue(definition, field, value, `${base}/${pointer(name)}`))
  }
  return changes
}

/**
 * Validate one value against canonical field metadata.
 * @param definition - Owning entity or abstract ancestor.
 * @param field - Effective field definition.
 * @param value - Submitted value.
 * @param path - Payload-rooted JSON Pointer.
 * @returns The normalized value.
 */
function validateValue(
  definition: EntityDefinition,
  field: EffectiveFieldDefinition,
  value: unknown,
  path: string,
): unknown {
  if (value === null) {
    if (field.nullable === true || field.type === FieldType.Entity) return null
    throw new MutationError('validation', `Field "${field.name}" must not be null`, { path })
  }
  if (field.type === FieldType.Entity) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new MutationError('validation', `Field "${field.name}" must be an identity string`, { path })
    }
    return value
  }
  if (field.type === FieldType.Array) return validateArray(field, value, path)
  if (field.type === FieldType.JSON) {
    try {
      return normalizeJSON(value)
    } catch (error) {
      throw new MutationError('validation', `Field "${field.name}" must be valid JSON`, {
        cause: error,
        path,
      })
    }
  }
  if (field.type === FieldType.String) {
    if (typeof value !== 'string') {
      throw new MutationError('validation', `Field "${field.name}" must be a string`, { path })
    }
    const length = [...value].length
    if (field.minLength !== undefined && length < field.minLength) {
      throw new MutationError(
        'validation',
        `Field "${field.name}" must contain at least ${field.minLength} characters`,
        { path },
      )
    }
    if (field.maxLength !== undefined && length > field.maxLength) {
      throw new MutationError(
        'validation',
        `Field "${field.name}" must contain at most ${field.maxLength} characters`,
        { path },
      )
    }
    return value
  }
  if (field.type === FieldType.Number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new MutationError('validation', `Field "${field.name}" must be a finite number`, { path })
    }
    if (field.minimum !== undefined && value < field.minimum) {
      throw new MutationError(
        'validation',
        `Field "${field.name}" must be at least ${field.minimum}`,
        { path },
      )
    }
    if (field.maximum !== undefined && value > field.maximum) {
      throw new MutationError(
        'validation',
        `Field "${field.name}" must be at most ${field.maximum}`,
        { path },
      )
    }
    return value
  }
  if (field.type === FieldType.Boolean) {
    if (typeof value !== 'boolean') {
      throw new MutationError('validation', `Field "${field.name}" must be a boolean`, { path })
    }
    return value
  }
  if (field.type === FieldType.Date) {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value !== 'string' || !isCalendarDate(value)) {
      throw new MutationError('validation', `Field "${field.name}" must be a date`, { path })
    }
    return value
  }
  if (field.type === FieldType.Timestamp) {
    if (value instanceof Date) return value
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new MutationError('validation', `Field "${field.name}" must be a timestamp`, { path })
    }
    return value
  }
  if (field.type === FieldType.ID) {
    return validateIdentity(definition, value, path)
  }
  throw new MutationError('validation', `Field "${field.name}" is not writable`, { path })
}

/**
 * Validate one native array value.
 * @param field - Array field definition.
 * @param value - Submitted value.
 * @param path - Payload-rooted JSON Pointer.
 * @returns The normalized array.
 */
function validateArray(
  field: ArrayFieldDefinition,
  value: unknown,
  path: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new MutationError('validation', `Field "${field.name}" must be an array`, { path })
  }
  return value.map((element, index) => {
    const elementPath = `${path}/${index}`
    if (element === null) {
      throw new MutationError('validation', 'Array element must not be null', { path: elementPath })
    }
    return validateScalarElement(field.items, field.name, element, elementPath)
  })
}

/**
 * Validate one array element against its declared scalar type.
 * @param item - Array element metadata.
 * @param field - Owning array field name.
 * @param value - Submitted element.
 * @param path - Payload-rooted JSON Pointer.
 * @returns The normalized element.
 */
function validateScalarElement(
  item: ScalarArrayElementDefinition,
  field: string,
  value: unknown,
  path: string,
): unknown {
  if (item.type === FieldType.String) {
    if (typeof value !== 'string') {
      throw new MutationError('validation', `Array "${field}" elements must be strings`, { path })
    }
    return value
  }
  if (item.type === FieldType.Number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new MutationError('validation', `Array "${field}" elements must be finite numbers`, { path })
    }
    return value
  }
  if (item.type === FieldType.Boolean) {
    if (typeof value !== 'boolean') {
      throw new MutationError('validation', `Array "${field}" elements must be booleans`, { path })
    }
    return value
  }
  if (item.type === FieldType.ID) {
    if (typeof value !== 'string' || !matchesFormat(value, item.format)) {
      throw new MutationError('validation', `Array "${field}" elements must be identities`, { path })
    }
    return value
  }
  if (item.type === FieldType.Date) {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value !== 'string' || !isCalendarDate(value)) {
      throw new MutationError('validation', `Array "${field}" elements must be dates`, { path })
    }
    return value
  }
  if (item.type === FieldType.Timestamp) {
    if (value instanceof Date) return value
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new MutationError('validation', `Array "${field}" elements must be timestamps`, { path })
    }
    return value
  }
  throw new MutationError('validation', `Array "${field}" elements are not writable`, { path })
}

/**
 * Validate one root identity against the entity's declared format.
 * @param definition - Owning entity.
 * @param value - Submitted identity.
 * @param path - Payload-rooted JSON Pointer.
 * @returns The canonical identity text.
 */
function validateIdentity(definition: EntityDefinition, value: unknown, path: string): string {
  if (typeof value !== 'string' || !matchesFormat(value, definition.idFormat)) {
    throw new MutationError(
      'validation',
      `Field "id" must be a canonical ${definition.idFormat ?? 'UUID or Snowflake'} identity`,
      { path },
    )
  }
  return value
}

/**
 * Generate one canonical identity for a create.
 * @param definition - Concrete target entity.
 * @param path - Payload-rooted JSON Pointer.
 * @returns A canonical UUID identity.
 */
function generateIdentity(definition: EntityDefinition, path: string): string {
  if (definition.idFormat === 'Snowflake') {
    throw new MutationError(
      'validation',
      'Field "id" is required for entities with a Snowflake identity format',
      { path },
    )
  }
  return randomUUID()
}

/**
 * Whether an identity matches a declared format.
 * @param value - Identity text.
 * @param format - Declared format, or undefined for either supported format.
 * @returns Whether the value is canonical for the format.
 */
function matchesFormat(value: string, format: EntityDefinition['idFormat']): boolean {
  if (format === 'UUID') return isCanonicalUUID(value)
  if (format === 'Snowflake') return isCanonicalSnowflake(value)
  return isCanonicalUUID(value) || isCanonicalSnowflake(value)
}

/**
 * Whether an effective field is required on create.
 * @param field - Effective field.
 * @returns Whether a value must be supplied.
 */
function requiredField(field: EffectiveFieldDefinition): boolean {
  if (field.name === 'id' || READONLY_FIELDS.has(field.name)) return false
  if (field.default !== undefined) return false
  if (field.type === FieldType.Entity) return field.nullable === false
  return field.nullable !== true
}

/** One physical insert column. */
interface WriteColumn {
  /** Physical column name. */
  readonly column: string,
  /** Canonical field metadata, absent for root special columns. */
  readonly field?: FieldDefinition,
  /** Normalized value. */
  readonly value: unknown,
}

/**
 * Insert one entity and its complete MTI chain.
 * @param entities - Canonical definitions.
 * @param sql - Transaction-scoped SQL client.
 * @param definition - Concrete target entity.
 * @param item - Prepared create value.
 */
async function insert(
  entities: EntityDefinitions,
  sql: BunSQL,
  definition: EntityDefinition,
  item: PreparedCreate,
): Promise<void> {
  await execute(sql, insertStatement('Entity', [
    { column: 'id', value: item.id },
    { column: 'name', value: item.values.name },
    { column: 'entity', value: definition.name },
  ]))
  const ancestry = entities.ancestry(definition.name)
    .filter(table => table !== 'Entity')
    .reverse()
  for (const table of ancestry) {
    const columns: WriteColumn[] = [{ column: 'id', value: item.id }]
    for (const [name, value] of Object.entries(item.values)) {
      if (name === 'id') continue
      const field = findField(definition, name)
      if (field.owner !== table) continue
      columns.push({
        column: field.type === FieldType.Entity ? field.column : name,
        field,
        value,
      })
    }
    await execute(sql, insertStatement(table, columns))
  }
}

/**
 * Build one parameterized INSERT statement.
 * @param table - Physical table name.
 * @param columns - Physical columns and normalized values.
 * @returns The write statement.
 */
function insertStatement(table: string, columns: readonly WriteColumn[]): WriteStatement {
  const bindings: unknown[] = []
  const placeholders = columns.map(column => bindValue(column.value, column.field, bindings))
  return {
    sql: `INSERT INTO ${quote(table)} (${columns.map(column => quote(column.column)).join(', ')}) ` +
      `VALUES (${placeholders.join(', ')})`,
    values: bindings,
  }
}

/**
 * Bind one value, adapting arrays and JSON to PostgreSQL text parameters.
 * @param value - Normalized value.
 * @param field - Field metadata, when known.
 * @param bindings - Binding sink.
 * @returns The placeholder expression.
 */
function bindValue(
  value: unknown,
  field: FieldDefinition | undefined,
  bindings: unknown[],
): string {
  if (field?.type === FieldType.Array) {
    const array = value as readonly unknown[]
    if (array.length === 0) {
      const type = postgresScalarType(field.items.type)
      return `ARRAY[]::${type}[]`
    }
    const elements = array.map(element => {
      bindings.push(element)
      return `$${bindings.length}::${postgresScalarType(field.items.type)}`
    })
    return `ARRAY[${elements.join(', ')}]`
  }
  const type = field?.type === FieldType.JSON ? '::jsonb' : ''
  bindings.push(value)
  return `$${bindings.length}${type}`
}

/**
 * Update or no-op-update rows in one physical table.
 * @param definition - Entity or abstract ancestor.
 * @param sql - Transaction-scoped SQL client.
 * @param table - Physical table.
 * @param ids - Frozen identities.
 * @param changes - Logical field changes.
 * @returns The identities PostgreSQL allowed to update.
 */
async function writeIds(
  definition: EntityDefinition,
  sql: BunSQL,
  table: string,
  ids: readonly string[],
  changes: ReadonlyMap<string, unknown>,
): Promise<readonly string[]> {
  if (ids.length === 0) return []
  const bindings: unknown[] = []
  const assignments = [...changes].map(([name, value]) => {
    const field = findField(definition, name)
    const column = field.type === FieldType.Entity ? field.column : name
    return `${quote(column)} = ${bindValue(value, field, bindings)}`
  })
  if (assignments.length === 0) assignments.push(`${quote('id')} = ${quote('id')}`)
  const placeholders = ids.map(id => {
    bindings.push(id)
    return `$${bindings.length}`
  })
  const rows = await execute(sql, {
    sql: `UPDATE ${quote(table)} SET ${assignments.join(', ')} ` +
      `WHERE ${quote('id')} IN (${placeholders.join(', ')}) RETURNING ${quote('id')}`,
    values: bindings,
  })
  return rows.map(row => String(row.id))
}

/**
 * Delete one complete MTI chain in a single statement.
 *
 * Data-modifying CTEs share the command snapshot, so the root and parent
 * policies still see the concrete leaf while PostgreSQL checks the deferred
 * foreign keys against the statement's final state.
 * @param sql - Transaction-scoped SQL client.
 * @param leaf - Concrete leaf table.
 * @param ancestry - Intermediate parent tables from leaf toward the root.
 * @param ids - Frozen identities.
 * @returns The leaf identities PostgreSQL allowed to delete.
 */
async function deleteChain(
  sql: BunSQL,
  leaf: string,
  ancestry: readonly string[],
  ids: readonly string[],
): Promise<readonly string[]> {
  if (ids.length === 0) return []
  const bindings: unknown[] = []
  const placeholders = ids.map(id => {
    bindings.push(id)
    return `$${bindings.length}`
  })
  const condition = `${quote('id')} IN (${placeholders.join(', ')})`
  const parents = ancestry.map((table, index) => (
    `"parent_${index}_deleted" AS (` +
    `DELETE FROM ${quote(table)} WHERE ${quote('id')} IN (SELECT ${quote('id')} FROM "root_deleted") ` +
    `RETURNING ${quote('id')})`
  ))
  const rows = await execute(sql, {
    sql: 'WITH "root_deleted" AS (' +
      `DELETE FROM ${quote('Entity')} WHERE ${condition} RETURNING ${quote('id')}), ` +
      '"leaf_deleted" AS (' +
      `DELETE FROM ${quote(leaf)} WHERE ${quote('id')} IN (SELECT ${quote('id')} FROM "root_deleted") ` +
      `RETURNING ${quote('id')})` +
      (parents.length === 0 ? '' : `, ${parents.join(', ')}`) +
      ` SELECT ${quote('id')} FROM "leaf_deleted"`,
    values: bindings,
  })
  return rows.map(row => String(row.id))
}

/**
 * Select the frozen set of visible root identities for one filter.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param definition - Entity or abstract ancestor.
 * @param filter - Existing filter form.
 * @returns Selected identities in stable order.
 */
async function selectMatches(
  { entities, sql }: MutationOptions,
  definition: EntityDefinition,
  filter: MutationFilter,
): Promise<readonly SelectedIdentity[]> {
  let compiled: ReturnType<typeof compilePolymorphicQuery>
  try {
    compiled = compilePolymorphicQuery(entities, definition, {
      fields: ['id', 'entity'],
      limit: null,
      orderBy: 'id',
      where: filter,
    })
  } catch (error) {
    throw filterFailure(error)
  }
  try {
    const rows = await sql.unsafe<Record<string, unknown>[]>(compiled.sql, [...compiled.values])
    return rows.map(row => ({ entity: String(row.entity), id: String(row.id) }))
  } catch (error) {
    throw databaseFailure(error)
  }
}

/**
 * Acquire one transaction-scoped advisory lock for a filter's mutation target.
 * @param sql - Transaction-scoped SQL client.
 * @param entity - Target entity.
 * @param filter - Existing filter form.
 */
async function lockFilter(sql: BunSQL, entity: string, filter: MutationFilter): Promise<void> {
  await execute(sql, {
    sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    values: [`${entity}|${stableFilterKey(filter)}`],
  })
}

/**
 * Serialize one filter deterministically for advisory locking.
 * @param filter - Existing filter form.
 * @returns A stable text key.
 */
function stableFilterKey(filter: MutationFilter): string {
  if (typeof filter === 'string') return filter.trim()
  return stableValue(filter)
}

/**
 * Serialize a structured value with sorted object keys.
 * @param value - Structured filter value.
 * @returns Stable JSON text.
 */
function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(',')}}`
}

/**
 * Execute one parameterized write and return its rows.
 * @param sql - Transaction-scoped SQL client.
 * @param statement - Write statement.
 * @returns Returned rows.
 */
async function execute(
  sql: BunSQL,
  statement: WriteStatement,
): Promise<Record<string, unknown>[]> {
  try {
    return await sql.unsafe<Record<string, unknown>[]>(statement.sql, [...statement.values])
  } catch (error) {
    throw databaseFailure(error)
  }
}

/**
 * Resolve one exact entity.
 * @param entities - Canonical definitions.
 * @param name - Entity name.
 * @returns The entity definition.
 */
function requireEntity(entities: EntityDefinitions, name: string): EntityDefinition {
  const definition = entities.entity(name)
  if (!definition) throw new MutationError('operation', `Unknown entity "${name}"`)
  return definition
}

/**
 * Resolve one concrete entity.
 * @param entities - Canonical definitions.
 * @param name - Entity name.
 * @returns The concrete entity definition.
 */
function requireConcrete(entities: EntityDefinitions, name: string): EntityDefinition {
  const definition = requireEntity(entities, name)
  if (definition.abstract) {
    throw new MutationError('operation', `Entity "${name}" is abstract and cannot hold rows`)
  }
  return definition
}

/**
 * Resolve one previously validated effective field.
 * @param definition - Entity or abstract ancestor.
 * @param name - Logical field name.
 * @returns The effective field.
 */
function findField(definition: EntityDefinition, name: string): EffectiveFieldDefinition {
  const field = definition.effectiveFields.find(candidate => candidate.name === name)
  if (!field) throw new Error(`Unknown validated field "${definition.name}.${name}"`)
  return field
}

/**
 * Materialize one create input exactly once.
 * @param input - One value or finite synchronous iterable.
 * @returns Bounded value array.
 */
function materialize(input: MutationValues | Iterable<MutationValues>): readonly MutationValues[] {
  if (isPlainRecord(input)) return [input]
  if (input instanceof Map) {
    throw new MutationError(
      'operation',
      'Map create inputs are not implicit values; pass map.values()',
    )
  }
  if (
    input === null
    || typeof input !== 'object'
    || typeof (input as Iterable<unknown>)[Symbol.iterator] !== 'function'
  ) {
    throw new MutationError('validation', 'Create values must be an object or finite iterable')
  }
  const values: MutationValues[] = []
  for (const value of input as Iterable<unknown>) {
    if (values.length >= MAX_MUTATION_BATCH) {
      throw new MutationError(
        'validation',
        `Create input exceeds the maximum batch of ${MAX_MUTATION_BATCH} values`,
      )
    }
    if (!isPlainRecord(value)) {
      throw new MutationError('validation', 'Create iterable values must be plain objects', {
        path: `/values/${values.length}`,
      })
    }
    values.push(value)
  }
  return values
}

/**
 * Group selected identities by concrete leaf entity.
 * @param matches - Frozen identities.
 * @returns Identities grouped by leaf.
 */
function groupByIdentity(
  matches: readonly SelectedIdentity[],
): ReadonlyMap<string, readonly SelectedIdentity[]> {
  const groups = new Map<string, SelectedIdentity[]>()
  for (const match of matches) {
    const group = groups.get(match.entity) ?? []
    group.push(match)
    groups.set(match.entity, group)
  }
  return groups
}

/**
 * Convert a predicate/filter failure into the stable filter category.
 * @param error - Compiler failure.
 * @returns The stable mutation error.
 */
function filterFailure(error: unknown): MutationError {
  if (error instanceof MutationError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new MutationError('filter', `Invalid mutation filter: ${message}`, { cause: error })
}

/**
 * Convert a PostgreSQL failure into a stable mutation category.
 * @param error - Database failure.
 * @returns The stable mutation error.
 */
function databaseFailure(error: unknown): MutationError {
  if (error instanceof MutationError) return error
  const message = error instanceof Error ? error.message : String(error)
  const errno = typeof error === 'object' && error !== null
    ? (error as { errno?: unknown }).errno
    : undefined
  if (errno === '42501') return new MutationError('authorization', message, { cause: error })
  if (errno === '23505' || errno === '23503' || errno === '23514') {
    return new MutationError('constraint', message, { cause: error })
  }
  if (
    errno === '23502'
    || errno === '22001'
    || errno === '22P02'
    || errno === '22007'
    || errno === '22008'
  ) {
    return new MutationError('validation', message, { cause: error })
  }
  return new MutationError('infrastructure', message, { cause: error })
}

/**
 * Normalize a JSON-compatible mutation value.
 * @param value - Candidate value.
 * @param seen - Cycle detector.
 * @returns A JSON-compatible clone.
 */
function normalizeJSON(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error('JSON integers exceed the safe integer range')
    }
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('JSON values cannot be cyclic')
    seen.add(value)
    const normalized = value.map(item => normalizeJSON(item, seen))
    seen.delete(value)
    return normalized
  }
  if (typeof value !== 'object') throw new Error('JSON values must be JSON-compatible')
  if (seen.has(value)) throw new Error('JSON values cannot be cyclic')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('JSON values must contain only plain objects')
  }
  seen.add(value)
  const normalized = Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeJSON(entry, seen)]),
  )
  seen.delete(value)
  return normalized
}

/**
 * Whether a value is a plain object.
 * @param value - Candidate value.
 * @returns Whether it is a non-array plain object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Whether a string is a valid calendar date.
 * @param value - Candidate date.
 * @returns Whether it is an ISO calendar date.
 */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * Escape one JSON Pointer segment.
 * @param value - Raw segment.
 * @returns Escaped segment.
 */
function pointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

/**
 * Quote one PostgreSQL identifier.
 * @param identifier - Identifier text.
 * @returns The quoted identifier.
 */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
