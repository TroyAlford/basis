import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import type { ArrayFieldDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, ScalarArrayElementDefinition } from './EntityDefinitions'
import { FieldType, isCanonicalSnowflake, isCanonicalUUID } from './EntityDefinitions'
import { Operator } from './Operator'
import { compileEntityRecordQuery, compilePolymorphicQuery } from './PolymorphicQuery'
import { postgresScalarType } from './PostgresTypes'
import type { Filter } from './Predicate'

/** Maximum records accepted by one bulk mutation. */
export const MAX_MUTATION_BATCH = 1_000

/** Final Graph-native subject state inside one native transaction. */
type SubjectState = 'deleted' | 'written'
/** Entity ids touched by Graph-native verbs inside one native transaction. */
const affectedSubjects = new WeakMap<object, Map<string, Map<string, SubjectState>>>()

/**
 * Record one Graph-native subject write or delete for transaction-final validation.
 * @param sql - Transaction-scoped SQL client.
 * @param entity - Concrete entity name.
 * @param id - Written identity.
 * @param state - Final operation on the identity.
 */
function recordSubject(sql: object, entity: string, id: string, state: SubjectState = 'written'): void {
  const subjects = affectedSubjects.get(sql) ?? new Map<string, Map<string, SubjectState>>()
  const ids = subjects.get(entity) ?? new Map<string, SubjectState>()
  ids.set(id, state)
  subjects.set(entity, ids)
  affectedSubjects.set(sql, subjects)
}

/**
 * Read the final Graph-native subject states inside one native transaction.
 * @param sql - Transaction-scoped SQL client.
 * @returns Entity names mapped to identities and their final operation.
 */
function writtenSubjects(sql: object): ReadonlyMap<string, ReadonlyMap<string, SubjectState>> {
  return affectedSubjects.get(sql) ?? new Map<string, ReadonlyMap<string, SubjectState>>()
}

/**
 * Snapshot the Graph-native subject state for one native transaction.
 *
 * The returned restore function puts the tracker back exactly as it was before
 * a savepoint. Nested savepoints each hold their own deep snapshot, so an inner
 * rollback cannot erase or preserve an outer scope's writes.
 * @param sql - Transaction-scoped SQL client.
 * @returns A restore function for the current tracker state.
 */
export function snapshotWrittenSubjects(sql: object): () => void {
  const current = affectedSubjects.get(sql)
  const snapshot = new Map<string, Map<string, SubjectState>>()
  if (current) {
    for (const [entity, ids] of current) snapshot.set(entity, new Map(ids))
  }
  return () => {
    if (snapshot.size === 0) affectedSubjects.delete(sql)
    else affectedSubjects.set(sql, snapshot)
  }
}

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

/** One hydrated persisted mutation record. */
export type MutationRecord = Readonly<Record<string, unknown>> & {
  /** Concrete entity discriminator. */
  readonly entity: string,
  /** Canonical root identity. */
  readonly id: string,
  /** Root display name. */
  readonly name: string,
}

/** Result of a create operation. */
export interface CreateResult<RecordShape extends MutationRecord = MutationRecord> {
  /** Number of entities created. */
  readonly created: number,
  /** Hydrated record for a single-object create; absent for batch input. */
  readonly record?: RecordShape,
}

/** Result of an edit operation. */
export interface EditResult<RecordShape extends MutationRecord = MutationRecord> {
  /** Number of entities edited. */
  readonly edited: number,
  /** Hydrated record when exactly one authorized row was edited. */
  readonly record?: RecordShape,
}

/** Result of a delete operation. */
export interface DeleteResult {
  /** Number of entities deleted. */
  readonly deleted: number,
}

/** Result of an upsert operation. */
export interface UpsertResult<RecordShape extends MutationRecord = MutationRecord> {
  /** `1` when the create branch ran, otherwise `0`. */
  readonly created: number,
  /** `1` when the edit branch ran, otherwise `0`. */
  readonly edited: number,
  /** Hydrated created or edited record. */
  readonly record: RecordShape,
}

/** The Graph-native mutation vocabulary. */
export interface MutationDatabase {
  /**
   * Create one entity or a finite synchronous batch atomically.
   * @param entity - Exact concrete entity name.
   * @param values - One value object or a finite iterable of value objects.
   * @returns The created count, plus the hydrated record for a single object.
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
   * @returns The edited count, plus the record when exactly one row was edited.
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
   * @returns Which branch ran and the hydrated created or edited record.
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
    create: (entity, values) => (entities.relationship(entity)
      ? relationshipCreate({ entities, sql }, entity, values)
      : create({ entities, sql }, entity, values)),
    delete: (entity, filter) => (entities.relationship(entity)
      ? relationshipDelete({ entities, sql }, entity, filter)
      : remove({ entities, sql }, entity, filter)),
    edit: (entity, filter, changes) => (entities.relationship(entity)
      ? relationshipEdit({ entities, sql }, entity, filter, changes)
      : edit({ entities, sql }, entity, filter, changes)),
    upsert: (entity, filter, values) => (entities.relationship(entity)
      ? relationshipUpsert({ entities, sql }, entity, filter, values)
      : upsert({ entities, sql }, entity, filter, values)),
  }
}

/**
 * Resolve one relationship and its row-shaped projection view.
 * @param entities - Canonical definitions.
 * @param name - Relationship name.
 * @returns The relationship and record view.
 */
function relationshipDefinition(
  entities: EntityDefinitions,
  name: string,
): { relationship: NonNullable<ReturnType<EntityDefinitions['relationship']>>, view: EntityDefinition } {
  const relationship = entities.relationship(name)
  const view = relationship === undefined ? undefined : entities.relationshipRecord(name)
  if (relationship === undefined || view === undefined) {
    throw new MutationError('operation', `Unknown relationship "${name}"`)
  }
  return { relationship, view }
}

/**
 * Read the required endpoint key values from one relationship mutation filter.
 * @param relationship - Relationship being addressed.
 * @param filter - Endpoint key filter.
 * @returns Endpoint field names mapped to canonical identity strings.
 */
function relationshipKeys(
  relationship: NonNullable<ReturnType<EntityDefinitions['relationship']>>,
  filter: MutationFilter,
): Readonly<Record<string, string>> {
  if (!isPlainRecord(filter)) {
    throw new MutationError(
      'filter',
      `Relationship "${relationship.name}" mutations require endpoint key fields`,
    )
  }
  const keys: Record<string, string> = {}
  for (const endpoint of relationship.between) {
    const value = filter[endpoint.field]
    if (typeof value !== 'string' || value.length === 0) {
      throw new MutationError('validation', `Field "${endpoint.field}" is required`, {
        path: `/filter/${pointer(endpoint.field)}`,
      })
    }
    keys[endpoint.field] = value
  }
  return keys
}

/**
 * Build the SQL predicate and bindings for one relationship endpoint key.
 * @param relationship - Relationship being addressed.
 * @param keys - Endpoint values.
 * @param bindings - Binding sink.
 * @returns The quoted equality predicate.
 */
function relationshipKeyWhere(
  relationship: NonNullable<ReturnType<EntityDefinitions['relationship']>>,
  keys: Readonly<Record<string, string>>,
  bindings: unknown[],
): string {
  return relationship.between.map(endpoint => {
    bindings.push(keys[endpoint.field])
    return `${quote(`${endpoint.field}.id`)} = $${bindings.length}`
  }).join(' AND ')
}

/**
 * Read one relationship record by its endpoint keys.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param view - Relationship record projection view.
 * @param keys - Endpoint values.
 * @returns The hydrated record.
 */
async function readRelationshipRecord(
  { entities, sql }: MutationOptions,
  view: EntityDefinition,
  keys: Readonly<Record<string, string>>,
): Promise<MutationRecord> {
  const fields = view.effectiveFields.map(field => field.name)
  const entries = Object.entries(keys)
  let where: Filter
  if (entries.length === 1) {
    where = {
      field: entries[0]?.[0] as string,
      operator: Operator.Comparison.Equal,
      value: entries[0]?.[1],
    }
  } else {
    where = {
      filters: entries.map(([field, value]) => ({
        field,
        operator: Operator.Comparison.Equal,
        value,
      })),
      operator: Operator.Logical.And,
    }
  }
  const compiled = compilePolymorphicQuery(entities, view, {
    fields,
    limit: 1,
    projectionBudget: { paths: fields.length, work: Number.MAX_SAFE_INTEGER },
    where,
  })
  try {
    const rows = await sql.unsafe<Record<string, unknown>[]>(compiled.sql, [...compiled.values])
    const row = rows[0]
    if (!row) throw new MutationError('operation', 'Relationship record was not found after mutation')
    return compiled.hydrate(row) as MutationRecord
  } catch (error) {
    if (error instanceof MutationError) throw error
    throw databaseFailure(error)
  }
}

/**
 * Create one relationship record.
 * @param options - Canonical definitions and transaction client.
 * @param name - Relationship name.
 * @param input - Submitted endpoint and property values.
 * @returns The created record.
 */
async function relationshipCreate(
  options: MutationOptions,
  name: string,
  input: MutationValues | Iterable<MutationValues>,
): Promise<CreateResult> {
  const { relationship, view } = relationshipDefinition(options.entities, name)
  if (!isPlainRecord(input)) {
    throw new MutationError('validation', 'Relationship create values must be a plain object')
  }
  const values = new Map<string, unknown>()
  for (const [fieldName, value] of Object.entries(input)) {
    const field = view.effectiveFields.find(candidate => candidate.name === fieldName)
    if (!field) throw new MutationError('validation', `Unknown field "${fieldName}" on ${name}`, {
      path: `/values/${pointer(fieldName)}`,
    })
    values.set(fieldName, validateValue(view, field, value, `/values/${pointer(fieldName)}`))
  }
  for (const endpoint of relationship.between) {
    if (!values.has(endpoint.field)) {
      throw new MutationError('validation', `Field "${endpoint.field}" is required`, {
        path: `/values/${pointer(endpoint.field)}`,
      })
    }
  }
  for (const field of relationship.fields) {
    const effective = view.effectiveFields.find(candidate => candidate.name === field.name)
    if (effective && requiredField(effective) && !values.has(field.name)) {
      throw new MutationError('validation', `Field "${field.name}" is required`, {
        path: `/values/${pointer(field.name)}`,
      })
    }
  }
  const columns: WriteColumn[] = []
  for (const endpoint of relationship.between) {
    columns.push({
      column: `${endpoint.field}.id`,
      field: view.effectiveFields.find(field => field.name === endpoint.field),
      value: values.get(endpoint.field),
    })
  }
  for (const field of relationship.fields) {
    if (values.has(field.name)) {
      columns.push({
        column: field.name,
        field: view.effectiveFields.find(candidate => candidate.name === field.name),
        value: values.get(field.name),
      })
    }
  }
  await execute(options.sql, insertStatement(name, columns))
  const keys = Object.fromEntries(relationship.between.map(endpoint => (
    [endpoint.field, String(values.get(endpoint.field))]
  )))
  return { created: 1, record: await readRelationshipRecord(options, view, keys) }
}

/**
 * Edit one relationship record by endpoint keys.
 * @param options - Canonical definitions and transaction client.
 * @param name - Relationship name.
 * @param filter - Endpoint key filter.
 * @param changes - Relationship property changes.
 * @returns The edit result.
 */
async function relationshipEdit(
  options: MutationOptions,
  name: string,
  filter: MutationFilter,
  changes: MutationValues,
): Promise<EditResult> {
  const { relationship, view } = relationshipDefinition(options.entities, name)
  const keys = relationshipKeys(relationship, filter)
  if (!isPlainRecord(changes)) throw new MutationError('validation', 'Relationship changes must be a plain object')
  const columns: WriteColumn[] = []
  for (const [fieldName, value] of Object.entries(changes)) {
    if (relationship.between.some(endpoint => endpoint.field === fieldName)) {
      throw new MutationError('validation', `Endpoint field "${fieldName}" is immutable`, {
        path: `/changes/${pointer(fieldName)}`,
      })
    }
    const field = view.effectiveFields.find(candidate => candidate.name === fieldName)
    if (!field) throw new MutationError('validation', `Unknown field "${fieldName}" on ${name}`, {
      path: `/changes/${pointer(fieldName)}`,
    })
    columns.push({
      column: field.name,
      field,
      value: validateValue(view, field, value, `/changes/${pointer(fieldName)}`),
    })
  }
  if (columns.length === 0) return { edited: 0 }
  const bindings: unknown[] = []
  const assignments = columns.map(column => {
    const placeholder = bindValue(column.value, column.field, bindings)
    return `${quote(column.column)} = ${placeholder}`
  }).join(', ')
  const where = relationshipKeyWhere(relationship, keys, bindings)
  const rows = await execute(options.sql, {
    sql: `UPDATE ${quote(name)} SET ${assignments} WHERE ${where} ` +
      `RETURNING ${quote(`${relationship.between[0]?.field}.id`)}`,
    values: bindings,
  })
  if (rows.length !== 1) return { edited: rows.length }
  return { edited: 1, record: await readRelationshipRecord(options, view, keys) }
}

/**
 * Delete relationship records by endpoint keys.
 * @param options - Canonical definitions and transaction client.
 * @param name - Relationship name.
 * @param filter - Endpoint key filter.
 * @returns The delete result.
 */
async function relationshipDelete(
  options: MutationOptions,
  name: string,
  filter: MutationFilter,
): Promise<DeleteResult> {
  const { relationship } = relationshipDefinition(options.entities, name)
  const keys = relationshipKeys(relationship, filter)
  const bindings: unknown[] = []
  const where = relationshipKeyWhere(relationship, keys, bindings)
  const rows = await execute(options.sql, {
    sql: `DELETE FROM ${quote(name)} WHERE ${where} RETURNING ${quote(`${relationship.between[0]?.field}.id`)}`,
    values: bindings,
  })
  return { deleted: rows.length }
}

/**
 * Edit one relationship record by endpoint keys, or create it.
 * @param options - Canonical definitions and transaction client.
 * @param name - Relationship name.
 * @param filter - Endpoint key filter.
 * @param values - Values used for the edit or create branch.
 * @returns The upsert result.
 */
async function relationshipUpsert(
  options: MutationOptions,
  name: string,
  filter: MutationFilter,
  values: MutationValues,
): Promise<UpsertResult> {
  const { relationship, view } = relationshipDefinition(options.entities, name)
  const keys = relationshipKeys(relationship, filter)
  const existing = await readRelationshipRecord(options, view, keys).catch(error => {
    if (error instanceof MutationError && error.code === 'operation') return null
    throw error
  })
  if (existing === null) {
    const created = await relationshipCreate(options, name, { ...keys, ...values })
    return { created: 1, edited: 0, record: created.record as MutationRecord }
  }
  const edited = await relationshipEdit(options, name, keys, values)
  if (edited.record === undefined) {
    throw new MutationError('operation', 'Relationship upsert selected no editable record')
  }
  return { created: 0, edited: 1, record: edited.record }
}

/**
 * Validate the transaction-final state of every Graph-native subject written
 * in one native transaction.
 *
 * Validation runs after the caller's callback resolves and before commit. A
 * FALSE or UNKNOWN predicate for one surviving written subject aborts the whole
 * transaction through the standard mutation error boundary. Deleted subjects are
 * skipped by recorded mutation intent, never by probing visibility. Surviving
 * subjects are evaluated through their Graph-managed SECURITY DEFINER Boolean
 * helper, which reads the transaction-final row regardless of the writer's final
 * READ permission and returns only a Boolean.
 * @param entities - Canonical entity definitions.
 * @param sql - Native transaction client.
 * @throws {MutationError} When a surviving written subject violates a validation constraint.
 */
export async function validateTransactionState(
  entities: EntityDefinitions,
  sql: BunSQL,
): Promise<void> {
  const subjects = writtenSubjects(sql)
  if (subjects.size === 0) return
  for (const [name, states] of subjects) {
    const constraints = entities.validationConstraints(name)
    if (constraints.length === 0) continue
    const definition = entities.entity(name)
    if (!definition || definition.abstract) continue
    for (const [id, state] of states) {
      if (state === 'deleted') continue
      for (const constraint of constraints) {
        if (!constraint.validator) {
          throw new MutationError(
            'infrastructure',
            `Validation constraint "${constraint.name}" has no Graph-managed validator`,
          )
        }
        const [result] = await execute(sql, {
          sql: `SELECT ${constraint.validator}($1) AS "valid"`,
          values: [id],
        })
        if (result?.valid !== true) {
          throw new MutationError(
            'constraint',
            `Validation constraint "${constraint.name}" on "${constraint.owner}" failed`,
          )
        }
      }
    }
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
  const single = isPlainRecord(input)
  const values = materialize(input)
  const prepared = values.map((value, index) => prepareCreate(
    definition,
    value,
    single ? '/values' : `/values/${index}`,
  ))
  for (const item of prepared) {
    await insert(entities, sql, definition, item)
    recordSubject(sql, entity, item.id)
  }
  if (!single) return { created: prepared.length }
  const [item] = prepared
  if (!item) return { created: 0 }
  return {
    created: 1,
    record: await readRecord({ entities, sql }, definition, item.id),
  }
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
  const mutable = await applyEdit({ entities, sql }, definition, matches, normalized)
  for (const identity of mutable) recordSubject(sql, identity.entity, identity.id)
  if (mutable.length !== 1) return { edited: mutable.length }
  const [identity] = mutable
  if (!identity) return { edited: 0 }
  const leaf = requireConcrete(entities, identity.entity)
  return {
    edited: 1,
    record: await readRecord({ entities, sql }, leaf, identity.id),
  }
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
    const deletedIds = await deleteChain(sql, leaf, ancestry, ids)
    for (const id of deletedIds) recordSubject(sql, leaf, id, 'deleted')
    deleted += deletedIds.length
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
  await lockEntity(sql, entity)
  const matches = await selectMatches({ entities, sql }, definition, filter)
  if (matches.length === 0) {
    return createUpsert({ entities, sql }, definition, filter, values)
  }

  const mutable = await authorizeEdit({ entities, sql }, definition, matches)
  if (mutable.length === 0) {
    return createUpsert({ entities, sql }, definition, filter, values)
  }
  if (mutable.length > 1) {
    throw new MutationError(
      'cardinality',
      `Upsert selected ${mutable.length} mutable entities; exactly one is required`,
    )
  }
  const changes = prepareChanges(entities, definition, values, '/values')
  await applyChanges({ entities, sql }, definition, mutable, changes)
  for (const identity of mutable) recordSubject(sql, identity.entity, identity.id)
  const [identity] = mutable
  if (!identity) throw new MutationError('infrastructure', 'Upsert edit lost its mutable row')
  return {
    created: 0,
    edited: 1,
    record: await readRecord({ entities, sql }, definition, identity.id),
  }
}

/**
 * Create one upsert row and prove it satisfies the same selection filter.
 *
 * The savepoint keeps a non-matching create payload from leaving a row behind
 * when a caller catches the stable mutation error inside an outer transaction.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param definition - Concrete target entity.
 * @param filter - Selection filter reused for verification.
 * @param values - Create branch values.
 * @returns The created count.
 */
async function createUpsert(
  { entities, sql }: MutationOptions,
  definition: EntityDefinition,
  filter: MutationFilter,
  values: MutationValues,
): Promise<UpsertResult> {
  const name = `basis_upsert_${randomUUID().replaceAll('-', '')}`
  await execute(sql, { sql: `SAVEPOINT ${quote(name)}`, values: [] })
  try {
    const item = prepareCreate(definition, values, '/values')
    await insert(entities, sql, definition, item)
    const matches = await selectMatches({ entities, sql }, definition, filter)
    if (!matches.some(match => match.id === item.id)) {
      throw new MutationError(
        'operation',
        'Upsert create values do not satisfy the selection filter',
      )
    }
    await execute(sql, { sql: `RELEASE SAVEPOINT ${quote(name)}`, values: [] })
    recordSubject(sql, definition.name, item.id)
    return {
      created: 1,
      edited: 0,
      record: await readRecord({ entities, sql }, definition, item.id),
    }
  } catch (error) {
    await sql.unsafe(`ROLLBACK TO SAVEPOINT ${quote(name)}`).catch(() => undefined)
    await sql.unsafe(`RELEASE SAVEPOINT ${quote(name)}`).catch(() => undefined)
    throw error
  }
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
): Promise<readonly SelectedIdentity[]> {
  if (matches.length === 0) return []
  const mutable = await authorizeEdit(options, definition, matches)
  await applyChanges(options, definition, mutable, changes)
  return mutable
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
 * @param base - Payload-rooted JSON Pointer for this value.
 * @returns The prepared create value.
 */
function prepareCreate(
  definition: EntityDefinition,
  input: MutationValues,
  base: string,
): PreparedCreate {
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
    if (field.nullable === true || (field.type === FieldType.Entity && field.nullable !== false)) {
      return null
    }
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
  if (field.type === FieldType.Enum) {
    if (typeof value !== 'string') {
      throw new MutationError('validation', `Field "${field.name}" must be a string enum value`, { path })
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
    const type = postgresScalarType(field.items.type)
    if (value === null) {
      bindings.push(null)
      return `$${bindings.length}::${type}[]`
    }
    const array = value as readonly unknown[]
    if (array.length === 0) {
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
 * Acquire one transaction-scoped advisory lock for an entity's upserts.
 *
 * A conservative per-entity lock guarantees that semantically equivalent
 * string and structured filters cannot race each other into duplicate creates.
 * @param sql - Transaction-scoped SQL client.
 * @param entity - Target entity.
 */
async function lockEntity(sql: BunSQL, entity: string): Promise<void> {
  await execute(sql, {
    sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    values: [entity],
  })
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
 * Read one persisted record through the canonical query compiler and hydrator.
 * @param options - Canonical definitions and transaction client.
 * @param options.entities - Canonical entity definitions.
 * @param options.sql - Transaction-scoped SQL client.
 * @param definition - Concrete entity definition.
 * @param id - Canonical identity.
 * @returns The hydrated record.
 * @throws {MutationError} When the persisted row cannot be read.
 */
async function readRecord(
  { entities, sql }: MutationOptions,
  definition: EntityDefinition,
  id: string,
): Promise<MutationRecord> {
  let compiled: ReturnType<typeof compileEntityRecordQuery>
  try {
    compiled = compileEntityRecordQuery(entities, definition, id)
  } catch (error) {
    throw filterFailure(error)
  }
  const rows = await execute(sql, { sql: compiled.sql, values: compiled.values })
  const [row] = rows
  if (!row) {
    throw new MutationError('infrastructure', `Persisted ${definition.name} record was not found`)
  }
  return compiled.hydrate(row) as MutationRecord
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
