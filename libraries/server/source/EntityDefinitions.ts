import type { SQL } from 'bun'

/** Enable PostgreSQL trigram search for universal names. */
const IDENTITY_EXTENSION_DDL = 'create extension if not exists pg_trgm with schema public'

/**
 * Canonical field types.
 *
 * `Entity` is the singular reference kind. `ID` is the universal identity
 * field type; concrete UUID/Snowflake variants are selected by `format`.
 */
export enum FieldType {
  /** Boolean value. */
  Boolean = 'Boolean',
  /** Calendar date without a time of day. */
  Date = 'Date',
  /** Singular reference to another entity. */
  Entity = 'Entity',
  /** Universal text identity. */
  ID = 'ID',
  /** Numeric value, including integers and floating point numbers. */
  Number = 'Number',
  /** Text value. */
  String = 'String',
  /** Instant in time. */
  Timestamp = 'Timestamp',
}

/** Field types that represent scalar values. */
export type ScalarFieldType =
  | FieldType.Boolean
  | FieldType.Date
  | FieldType.ID
  | FieldType.Number
  | FieldType.String
  | FieldType.Timestamp

/** Supported canonical identity formats. */
export type IdentityFormat = 'Snowflake' | 'UUID'

/** One scalar field definition. */
export interface ScalarFieldDefinition {
  /** Canonical format for an ID field. */
  readonly format?: IdentityFormat,
  /** Field name, in camelCase. */
  readonly name: string,
  /** Scalar field type. */
  readonly type: ScalarFieldType,
}

/** One singular entity-reference field. */
export interface EntityReferenceFieldDefinition {
  /** Explicit PostgreSQL column name backing the reference. */
  readonly column: string,
  /** Logical field name used by entity-rooted queries. */
  readonly name: string,
  /** Referenced entity name. */
  readonly target: string,
  /** Field-kind discriminator. */
  readonly type: FieldType.Entity,
}

/** One logical entity field. */
export type FieldDefinition = ScalarFieldDefinition | EntityReferenceFieldDefinition

/** One effective inherited field and its owning entity table. */
export type EffectiveFieldDefinition = FieldDefinition & {
  /** Entity table that physically owns this field. */
  readonly owner: string,
}

/** One entity definition. */
export interface EntityDefinition {
  /** Whether this entity has descendants and cannot be a concrete leaf. */
  readonly abstract: boolean,
  /** Effective inherited and locally owned fields. */
  readonly effectiveFields: readonly EffectiveFieldDefinition[],
  /** Declared parent entity, when present. */
  readonly extends?: string,
  /** Locally owned fields plus the generated shared `id` field. */
  readonly fields: readonly FieldDefinition[],
  /** Effective inherited ID format. */
  readonly idFormat?: IdentityFormat,
  /** Entity type name, in PascalCase. */
  readonly name: string,
  /** Parent entity name, or the system `Entity` root. */
  readonly parent: string,
}

/** One physical table column compiled from canonical or system metadata. */
interface TableColumn {
  /** Physical column name. */
  readonly name: string,
  /** Whether this column is the table's primary key. */
  readonly primaryKey?: boolean,
  /** Physical scalar type. */
  readonly type: ScalarFieldType,
}

/** One physical table index. */
interface TableIndex {
  /** Indexed columns, in order. */
  readonly columns: readonly string[],
  /** Optional non-default index method. */
  readonly method?: 'gin',
  /** Index name. */
  readonly name: string,
  /** Optional operator class applied to every column. */
  readonly opclass?: string,
}

/** Internal physical table metadata shared by system and model-owned tables. */
interface TableDefinition {
  /** Table-level check constraints. */
  readonly checks?: readonly TableCheck[],
  /** Columns in physical order. */
  readonly columns: readonly TableColumn[],
  /** Table indexes, created after the table. */
  readonly indexes?: readonly TableIndex[],
  /** Physical table name. */
  readonly name: string,
}

/** One table-level check constraint. */
interface TableCheck {
  /** SQL boolean expression. */
  readonly expression: string,
  /** Constraint name. */
  readonly name: string,
}

/** One lifecycle function that must exist and match its canonical body. */
interface LifecycleFunction {
  /** Function body between the dollar quotes. */
  readonly body: string,
  /** Function name. */
  readonly name: string,
  /** Full CREATE OR REPLACE statement. */
  readonly statement: string,
}

/** One lifecycle constraint trigger that must exist and match. */
interface LifecycleTrigger {
  /** UPDATE OF columns, when declared. */
  readonly columns?: readonly string[],
  /** Whether this is a constraint trigger. */
  readonly constraint: boolean,
  /** Whether this is deferrable. */
  readonly deferrable: boolean,
  /** Function name. */
  readonly function: string,
  /** Whether this is initially deferred. */
  readonly initDeferred: boolean,
  /** Trigger name. */
  readonly name: string,
  /** Full CREATE TRIGGER statement. */
  readonly statement: string,
  /** Owning table. */
  readonly table: string,
  /** Trigger bitmask. */
  readonly type: number,
}

/** Canonical UUID identity pattern. */
const UUID_IDENTITY_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
/** Canonical signed 64-bit decimal identity pattern. */
const SNOWFLAKE_IDENTITY_PATTERN = '^(0|-?[1-9][0-9]*)$'
/** Canonical signed 64-bit decimal bounds. */
const SNOWFLAKE_MIN_TEXT = '-9223372036854775808'
const SNOWFLAKE_MAX_TEXT = '9223372036854775807'

/** Root-owned field names that ordinary entities cannot redeclare. */
const ROOT_FIELD_NAMES = new Set<string>([
  'entity',
  'name',
])

/** Formats accepted by canonical `id` refinements. */
const IDENTITY_FORMATS = new Set<string>([
  'Snowflake',
  'UUID',
])

/** Scalar field type names accepted by the entity definitions. */
const SCALAR_FIELD_TYPES = new Set<string>([
  FieldType.Boolean,
  FieldType.Date,
  FieldType.ID,
  FieldType.Number,
  FieldType.String,
  FieldType.Timestamp,
])

/**
 * Whether a value is a canonical lowercase UUID identity.
 * @param value - Candidate identity text.
 * @returns `true` for a canonical UUID.
 */
export function isCanonicalUUID(value: string): boolean {
  return new RegExp(UUID_IDENTITY_PATTERN).test(value)
}

/**
 * Whether a value is a canonical signed 64-bit decimal identity.
 * @param value - Candidate identity text.
 * @returns `true` for a canonical Snowflake-format value.
 */
export function isCanonicalSnowflake(value: string): boolean {
  if (value.length > 20 || !new RegExp(SNOWFLAKE_IDENTITY_PATTERN).test(value)) return false
  const numeric = BigInt(value)
  return numeric >= BigInt(SNOWFLAKE_MIN_TEXT) && numeric <= BigInt(SNOWFLAKE_MAX_TEXT)
}

/**
 * Resolve the effective identity format for every entity.
 * @param seeds - Parsed seeds by name.
 * @returns Effective formats by entity name.
 */
function effectiveFormats(seeds: ReadonlyMap<string, EntitySeed>): ReadonlyMap<string, IdentityFormat | undefined> {
  const result = new Map<string, IdentityFormat | undefined>()
  for (const seed of seeds.values()) {
    const chain: EntitySeed[] = []
    let current: EntitySeed | undefined = seed
    while (current) {
      chain.unshift(current)
      current = current.extends ? seeds.get(current.extends) : undefined
    }
    let format: IdentityFormat | undefined
    for (const part of chain) {
      if (!part.idFormat) continue
      if (format && format !== part.idFormat) {
        throw invalid(
          `id format conflict in entity "${seed.name}": ` +
          `inherited "${format}", redeclared "${part.idFormat}"`,
        )
      }
      format = part.idFormat
    }
    result.set(seed.name, format)
  }
  return result
}

/**
 * Resolve direct children for every entity.
 * @param seeds - Parsed seeds.
 * @returns Child names by parent entity.
 */
function childrenByEntity(seeds: readonly EntitySeed[]): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>()
  for (const seed of seeds) {
    if (!seed.extends) continue
    const list = children.get(seed.extends) ?? []
    list.push(seed.name)
    children.set(seed.extends, list)
  }
  return children
}

/**
 * Build root-owned effective fields.
 * @param format - Effective identity format.
 * @returns Root id, name and entity fields.
 */
function rootFields(format: IdentityFormat | undefined): readonly EffectiveFieldDefinition[] {
  return [
    { ...(format ? { format } : {}), name: 'id', owner: 'Entity', type: FieldType.ID },
    { name: 'name', owner: 'Entity', type: FieldType.String },
    { name: 'entity', owner: 'Entity', type: FieldType.String },
  ]
}

/**
 * Build the system-owned universal identity root.
 * @param entities - Validated entity definitions.
 * @returns The physical identity-root table.
 */
function identityRoot(entities: readonly EntityDefinition[]): TableDefinition {
  const leaves = entities.filter(entity => !entity.abstract).map(entity => quoteLiteral(entity.name))
  const leafCheck = leaves.length === 0 ? 'false' : `"entity" in (${leaves.join(', ')})`
  return {
    checks: [
      {
        expression: identityCheck('id', undefined),
        name: 'Entity_id_format_check',
      },
      {
        expression: leafCheck,
        name: 'Entity_entity_check',
      },
    ],
    columns: [
      { name: 'id', primaryKey: true, type: FieldType.ID },
      { name: 'name', type: FieldType.String },
      { name: 'entity', type: FieldType.String },
    ],
    indexes: [
      { columns: ['name', 'id'], name: 'Entity_name_id_idx' },
      {
        columns: ['name'],
        method: 'gin',
        name: 'Entity_name_trgm_idx',
        opclass: 'public.gin_trgm_ops',
      },
    ],
    name: 'Entity',
  }
}

/** Parsed and validated canonical entity definitions. */
export class EntityDefinitions {
  /** Entities in their declared order. */
  readonly entities: readonly EntityDefinition[]

  /**
   * Parse and validate canonical entity JSON.
   * @param source - Canonical JSON text.
   * @returns The validated entity definitions.
   * @throws {Error} When the JSON or entity definitions are invalid.
   */
  static load(source: string): EntityDefinitions {
    let value: unknown
    try {
      value = JSON.parse(source)
    } catch (error) {
      throw new Error('Invalid entity JSON', { cause: error })
    }
    return new EntityDefinitions(parseEntities(value))
  }

  /**
   * Creates entity definitions from already-validated definitions.
   * @param entities - Validated entity definitions.
   */
  private constructor(entities: readonly EntityDefinition[]) {
    this.entities = entities
  }

  /**
   * Resolve the physical tables for the identity root and declared entities.
   * @returns System-owned root followed by model-owned tables in order.
   */
  private get tables(): readonly TableDefinition[] {
    return [identityRoot(this.entities), ...this.entities.map(entityTable)]
  }

  /**
   * Find an entity by name.
   * @param name - Exact entity name.
   * @returns The entity, or undefined when absent.
   */
  entity(name: string): EntityDefinition | undefined {
    return this.entities.find(entity => entity.name === name)
  }

  /**
   * Deterministic PostgreSQL DDL for the identity root and declared entities.
   *
   * Every table, column and index is created first, in declaration order;
   * foreign-key constraints and lifecycle checks follow. This is a
   * fresh-schema compiler, not a migration planner.
   * @returns The complete ordered DDL sequence.
   */
  get ddl(): readonly string[] {
    return [
      IDENTITY_EXTENSION_DDL,
      ...this.tables.flatMap(tableStatements),
      ...this.entities.map(entity => addParentConstraint(entity)),
      ...this.entities.flatMap(entity => entity.fields
        .filter(isReferenceField)
        .map(field => addConstraint(entity, field))),
      ...lifecycleStatements(this.entities),
    ]
  }

  /**
   * Create a fresh schema and reconcile existing integrity definitions.
   *
   * The caller owns transaction scope; use `db.tx` for an atomic initialization.
   * Existing tables are not migrated. Existing lifecycle functions and
   * triggers are inspected; matching definitions are left untouched and
   * mismatches fail visibly rather than being silently replaced.
   * @param sql - The connected Bun SQL client.
   * @returns A promise that resolves after initialization and reconciliation.
   * @throws {Error} When a constraint or lifecycle definition does not match.
   */
  async createTables(sql: SQL): Promise<void> {
    await sql.unsafe(IDENTITY_EXTENSION_DDL).simple()
    for (const table of this.tables) {
      const rows = await sql<{ present: boolean }[]>`
SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = current_schema() AND tablename
          = ${table.name} ) AS present
      `
      const created = !rows[0]?.present
      if (created) await sql.unsafe(createTable(table)).simple()
      for (const index of table.indexes ?? []) {
        if (!created && await indexExists(sql, index.name)) continue
        await sql.unsafe(createIndex(table, index)).simple()
      }
    }

    for (const entity of this.entities) {
      await reconcileForeignKey(
        sql,
        entity.name,
        parentConstraintName(entity),
        'id',
        entity.parent,
        'id',
        addParentConstraint(entity),
      )
      for (const field of entity.fields.filter(isReferenceField)) {
        await reconcileForeignKey(
          sql,
          entity.name,
          constraintName(entity, field),
          field.column,
          field.target,
          'id',
          addConstraint(entity, field),
        )
      }
    }

    const lifecycle = lifecycleDefinitions(this.entities)
    for (const statement of lifecycle.functions) {
      const existing = await sql<{
        body: string,
        normalFunction: boolean,
        plpgsql: boolean,
        returnTrigger: boolean,
        securityDefiner: boolean,
      }[]>`
        SELECT p.prosrc AS body,
          p.prokind = 'f' AS "normalFunction",
          p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql') AS plpgsql,
          p.prorettype = 'trigger'::regtype AS "returnTrigger",
          p.prosecdef AS "securityDefiner"
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema() AND p.proname = ${statement.name} AND p.pronargs = 0
      `
      if (!existing[0]) {
        await sql.unsafe(statement.statement).simple()
        continue
      }
      const currentFunction = existing[0]
      if (
        normalizeBody(currentFunction.body) !== normalizeBody(statement.body)
        || !currentFunction.normalFunction
        || !currentFunction.plpgsql
        || !currentFunction.returnTrigger
        || currentFunction.securityDefiner
      ) {
        throw new Error(`Existing lifecycle function "${statement.name}" does not match the canonical model`)
      }
    }
    for (const trigger of lifecycle.triggers) {
      const existing = await sql<{
        columns: string[],
        constraint: number,
        deferrable: boolean,
        enabled: string,
        functionName: string,
        functionSchema: boolean,
        initDeferred: boolean,
        noWhen: boolean,
        type: number,
      }[]>`
SELECT coalesce((SELECT array_agg(a.attname ORDER BY u.ordinality) FROM unnest(t.tgattr::smallint[])
  WITH ordinality u(attnum,
ordinality) JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = u.attnum ),
          '{}'::text[]) AS columns,
          t.tgconstraint AS CONSTRAINT,
          t.tgdeferrable AS DEFERRABLE,
          t.tgenabled AS enabled,
          p.proname AS "functionName",
          n.nspname = current_schema() AS "functionSchema",
          t.tginitdeferred AS "initDeferred",
          t.tgqual IS NULL AS "noWhen",
          t.tgtype AS type
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE t.tgname = ${trigger.name} AND t.tgrelid = ${quoteIdentifier(trigger.table)}::regclass AND NOT
  t.tgisinternal
      `
      if (!existing[0]) {
        await sql.unsafe(trigger.statement).simple()
        continue
      }
      const current = existing[0]
      if (
        current.deferrable !== trigger.deferrable
        || current.enabled !== 'O'
        || current.initDeferred !== trigger.initDeferred
        || (current.constraint !== 0) !== trigger.constraint
        || current.functionName !== trigger.function
        || !current.functionSchema
        || !current.noWhen
        || current.type !== trigger.type
        || current.columns.join(',') !== (trigger.columns ?? []).join(',')
      ) {
        throw new Error(
          `Existing lifecycle trigger "${trigger.name}" on "${trigger.table}" ` +
          'does not match the canonical model',
        )
      }
    }
  }
}

/**
 * Normalize a PL/pgSQL body for catalog comparison.
 * @param body - Function body.
 * @returns The comparison text.
 */
function normalizeBody(body: string): string {
  return body.replaceAll('\r\n', '\n').trim()
}

/**
 * Validate the parsed entity document root.
 * @param value - Parsed JSON value.
 * @returns Validated entities.
 */
function parseEntities(value: unknown): readonly EntityDefinition[] {
  if (!isRecord(value)) throw invalid('entity definitions must be an object')
  assertKnownKeys(value, ['entities'], 'top-level')
  if (!Array.isArray(value.entities) || value.entities.length === 0) {
    throw invalid('entities must be a non-empty array')
  }

  const seeds = value.entities.map(parseEntity)
  const byName = new Map<string, EntitySeed>()
  for (const seed of seeds) {
    if (byName.has(seed.name)) throw invalid(`duplicate entity "${seed.name}"`)
    byName.set(seed.name, seed)
  }
  validateAncestry(seeds, byName)
  for (const seed of seeds) {
    for (const field of seed.fields) {
      if (field.type === FieldType.Entity && field.target !== 'Entity' && !byName.has(field.target)) {
        throw invalid(`unknown target entity "${field.target}" for field "${seed.name}.${field.name}"`)
      }
    }
  }
  const formats = effectiveFormats(byName)
  const children = childrenByEntity(seeds)
  return seeds.map(seed => resolveEntity(seed, byName, formats, children))
}

/** A parsed entity before reference targets are resolved. */
interface EntitySeed {
  /** Declared parent entity, when present. */
  readonly extends?: string,
  /** Locally owned fields, excluding the `id` refinement. */
  readonly fields: readonly FieldDefinition[],
  /** Declared ID format refinement on this entity. */
  readonly idFormat?: IdentityFormat,
  /** Entity type name. */
  readonly name: string,
}

/**
 * Validate parent references, cycles and field ownership.
 * @param seeds - Parsed seeds.
 * @param byName - Seeds by name.
 */
function validateAncestry(
  seeds: readonly EntitySeed[],
  byName: ReadonlyMap<string, EntitySeed>,
): void {
  for (const seed of seeds) {
    if (seed.extends !== undefined) {
      if (seed.extends === 'Entity') throw invalid('extends "Entity" is implicit and cannot be authored')
      if (!byName.has(seed.extends)) throw invalid(`unknown parent entity "${seed.extends}"`)
    }
  }

  for (const seed of seeds) {
    const seen = new Set<string>()
    let current: string | undefined = seed.name
    while (current !== undefined) {
      if (seen.has(current)) throw invalid(`ancestry cycle detected at entity "${current}"`)
      seen.add(current)
      current = byName.get(current)?.extends
    }
  }

  for (const seed of seeds) {
    const names = new Map<string, string>()
    const columns = new Map<string, string>()
    let parentName = seed.extends
    while (parentName !== undefined) {
      const parent = byName.get(parentName)
      if (!parent) break
      for (const field of parent.fields) {
        names.set(field.name, parent.name)
        columns.set(fieldColumn(field), parent.name)
      }
      parentName = parent.extends
    }
    for (const field of seed.fields) {
      const owner = names.get(field.name)
      if (owner) throw invalid(`field "${seed.name}.${field.name}" is already owned by "${owner}"`)
      const column = fieldColumn(field)
      const columnOwner = columns.get(column)
      if (columnOwner) {
        throw invalid(`physical column "${column}" is already owned by "${columnOwner}"`)
      }
    }
  }
}

/**
 * Validate one entity definition.
 * @param value - Parsed entity candidate.
 * @returns The validated entity seed.
 */
function parseEntity(value: unknown): EntitySeed {
  if (!isRecord(value)) throw invalid('entity must be an object')
  assertKnownKeys(value, ['extends', 'fields', 'name'], 'entity')
  if (typeof value.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid('entity name must be a PascalCase identifier')
  }
  if (value.name === 'Entity') throw invalid('entity name "Entity" is reserved for the universal identity root')
  if (
    value.extends !== undefined
    && (typeof value.extends !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.extends))
  ) {
    throw invalid(`entity "${value.name}" extends must be a PascalCase entity name`)
  }
  if (!Array.isArray(value.fields)) {
    throw invalid(`entity "${value.name}" must define a fields array`)
  }

  const names = new Set<string>()
  const fields: FieldDefinition[] = []
  let idFormat: IdentityFormat | undefined
  for (const candidate of value.fields) {
    const parsed = parseField(value.name, candidate)
    if ('idRefinement' in parsed) {
      if (idFormat) throw invalid(`duplicate id refinement in entity "${value.name}"`)
      idFormat = parsed.idFormat
      continue
    }
    const field = parsed.field
    if (names.has(field.name)) throw invalid(`duplicate field "${value.name}.${field.name}"`)
    names.add(field.name)
    fields.push(field)
  }
  return { extends: value.extends as string | undefined, fields, idFormat, name: value.name }
}

/** Parsed field result, including the special `id` refinement. */
type ParsedFieldResult =
  | { readonly field: FieldDefinition }
  | { readonly idFormat: IdentityFormat, readonly idRefinement: true }

/**
 * Validate one field descriptor.
 * @param entityName - Owning entity name.
 * @param value - Field candidate.
 * @returns The parsed field or id refinement.
 */
function parseField(entityName: string, value: unknown): ParsedFieldResult {
  if (!isRecord(value)) throw invalid(`field "${entityName}" must be an object`)
  if (typeof value.field !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.field)) {
    throw invalid(`field name must be a camelCase identifier in "${entityName}"`)
  }
  if (typeof value.type !== 'string' && value.field !== 'id') {
    throw invalid(`field "${entityName}.${value.field}" type must be a string`)
  }

  if (value.type === FieldType.Entity) {
    assertKnownKeys(value, ['column', 'field', 'target', 'type'], 'field')
    if (ROOT_FIELD_NAMES.has(value.field) || value.field === 'id') {
      throw invalid(`field "${entityName}.${value.field}" is reserved for the universal identity root`)
    }
    if (typeof value.target !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.target)) {
      throw invalid(`reference field "${entityName}.${value.field}" target must be a PascalCase entity name`)
    }
    if (typeof value.column !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.column)) {
      throw invalid(`reference field "${entityName}.${value.field}" column must be a camelCase identifier`)
    }
    return {
      field: {
        column: value.column,
        name: value.field,
        target: value.target,
        type: FieldType.Entity,
      },
    }
  }

  if (value.field === 'id') {
    assertKnownKeys(value, ['field', 'format'], 'field')
    if (typeof value.format !== 'string' || !IDENTITY_FORMATS.has(value.format)) {
      throw invalid(`id refinement in "${entityName}" must specify format UUID or Snowflake`)
    }
    return { idFormat: value.format as IdentityFormat, idRefinement: true }
  }

  if (ROOT_FIELD_NAMES.has(value.field)) {
    throw invalid(`field "${entityName}.${value.field}" is reserved for the universal identity root`)
  }
  assertKnownKeys(value, ['field', 'format', 'type'], 'field')
  const type = value.type as string
  if (!SCALAR_FIELD_TYPES.has(type) || type === FieldType.ID) {
    throw invalid(`unsupported field type "${String(type)}" in "${entityName}.${value.field}"`)
  }
  if (value.format !== undefined) {
    throw invalid(`field "${entityName}.${value.field}" format is only valid on type ID`)
  }
  return {
    field: {
      name: value.field,
      type: type as ScalarFieldType,
    },
  }
}

/**
 * Resolve one entity against its complete ancestry.
 * @param seed - Validated entity seed.
 * @param byName - Seeds by name.
 * @param formats - Effective ID formats.
 * @param children - Direct children by parent.
 * @returns The resolved entity.
 */
function resolveEntity(
  seed: EntitySeed,
  byName: ReadonlyMap<string, EntitySeed>,
  formats: ReadonlyMap<string, IdentityFormat | undefined>,
  children: ReadonlyMap<string, readonly string[]>,
): EntityDefinition {
  const effective: EffectiveFieldDefinition[] = [...rootFields(formats.get(seed.name))]
  const ancestors: EntitySeed[] = []
  let current = seed.extends ? byName.get(seed.extends) : undefined
  while (current) {
    ancestors.unshift(current)
    current = current.extends ? byName.get(current.extends) : undefined
  }
  for (const ancestor of ancestors) {
    for (const field of ancestor.fields) effective.push({ ...field, owner: ancestor.name })
  }
  for (const field of seed.fields) effective.push({ ...field, owner: seed.name })
  const idField: ScalarFieldDefinition = {
    ...(formats.get(seed.name) ? { format: formats.get(seed.name) } : {}),
    name: 'id',
    type: FieldType.ID,
  }
  return {
    abstract: (children.get(seed.name)?.length ?? 0) > 0,
    effectiveFields: effective,
    ...(seed.extends ? { extends: seed.extends } : {}),
    fields: [idField, ...seed.fields],
    ...(formats.get(seed.name) ? { idFormat: formats.get(seed.name) } : {}),
    name: seed.name,
    parent: seed.extends ?? 'Entity',
  }
}

/**
 * Build one entity table from locally owned fields.
 * @param entity - Validated entity.
 * @returns Its physical table metadata.
 */
function entityTable(entity: EntityDefinition): TableDefinition {
  return {
    checks: [{
      expression: identityCheck('id', entity.idFormat),
      name: `${entity.name}_id_format_check`,
    }],
    columns: entity.fields.map(field => {
      if (field.type === FieldType.Entity) return { name: field.column, type: FieldType.String }
      if (field.type === FieldType.ID) return { name: field.name, primaryKey: true, type: FieldType.ID }
      return { name: field.name, type: field.type }
    }),
    name: entity.name,
  }
}

/**
 * Build one identity-format SQL predicate.
 * @param column - Physical identity column.
 * @param format - Effective format, or undefined for either format.
 * @returns A PostgreSQL boolean expression.
 */
function identityCheck(column: string, format: IdentityFormat | undefined): string {
  const identifier = quoteIdentifier(column)
  const uuid = `${identifier} ~ '${UUID_IDENTITY_PATTERN}'`
  if (format === 'UUID') return uuid
  const snowflake = `case
    when ${identifier} ~ '${SNOWFLAKE_IDENTITY_PATTERN}' and length(${identifier}) <= 20
      then ${identifier}::numeric between ${SNOWFLAKE_MIN_TEXT} and ${SNOWFLAKE_MAX_TEXT}
    else false
  end`
  if (format === 'Snowflake') return snowflake
  return `(${uuid} or ${snowflake})`
}

/**
 * Build statements for one physical table.
 * @param table - Physical table metadata.
 * @returns Its table statement followed by index statements.
 */
function tableStatements(table: TableDefinition): readonly string[] {
  return [
    createTable(table),
    ...(table.indexes ?? []).map(index => createIndex(table, index)),
  ]
}

/**
 * Build one physical table statement.
 * @param table - Physical table metadata.
 * @returns The PostgreSQL DDL statement.
 */
function createTable(table: TableDefinition): string {
  const columns = table.columns.map(column => {
    const nullability = column.primaryKey ? ' primary key' : ' not null'
    return `${quoteIdentifier(column.name)} ${columnType(column.type)}${nullability}`
  })
  const checks = (table.checks ?? []).map(check => (
    `constraint ${quoteIdentifier(check.name)} check (${check.expression})`
  ))
  return `create table ${quoteIdentifier(table.name)} (\n${[...columns, ...checks].join(',\n')}\n)`
}

/**
 * Build one physical table index.
 * @param table - Owning table.
 * @param index - Index metadata.
 * @returns The create-index statement.
 */
function createIndex(table: TableDefinition, index: TableIndex): string {
  const method = index.method ? ` using ${index.method}` : ''
  const columns = index.columns.map(column => (
    `${quoteIdentifier(column)}${index.opclass ? ` ${index.opclass}` : ''}`
  ))
  return `create index if not exists ${quoteIdentifier(index.name)} ` +
    `on ${quoteIdentifier(table.name)}${method} (${columns.join(', ')})`
}

/**
 * Build one MTI parent foreign-key statement.
 * @param entity - Owning entity.
 * @returns The alter-table statement.
 */
function addParentConstraint(entity: EntityDefinition): string {
  return `alter table ${quoteIdentifier(entity.name)} ` +
    `add constraint ${quoteIdentifier(parentConstraintName(entity))} ` +
    'foreign key ("id") references ' +
    `${quoteIdentifier(entity.parent)} ("id") deferrable initially immediate`
}

/**
 * Build one reference foreign-key statement.
 * @param entity - Owning entity.
 * @param field - Reference field.
 * @returns The alter-table statement.
 */
function addConstraint(entity: EntityDefinition, field: EntityReferenceFieldDefinition): string {
  return `alter table ${quoteIdentifier(entity.name)} ` +
    `add constraint ${quoteIdentifier(constraintName(entity, field))} ` +
    `foreign key (${quoteIdentifier(field.column)}) ` +
    `references ${quoteIdentifier(field.target)} ("id") deferrable initially immediate`
}

/**
 * Reconcile one canonical foreign key.
 * @param sql - SQL client.
 * @param entityName - Owning table.
 * @param name - Constraint name.
 * @param localColumn - Local column.
 * @param targetName - Target table.
 * @param targetColumn - Target column.
 * @param statement - Statement for a missing constraint.
 * @returns A promise that resolves after reconciliation.
 */
async function reconcileForeignKey(
  sql: SQL,
  entityName: string,
  name: string,
  localColumn: string,
  targetName: string,
  targetColumn: string,
  statement: string,
): Promise<void> {
  const rows = await sql<{
    deferrable: boolean,
    deferred: boolean,
    deleteAction: string,
    localColumn: string,
    matchType: string,
    targetColumn: string,
    targetMatches: boolean,
    updateAction: string,
    validated: boolean,
  }[]>`
    SELECT con.condeferrable AS DEFERRABLE,
      con.condeferred AS deferred,
      con.confdeltype AS "deleteAction",
      con.confmatchtype AS "matchType",
      con.confrelid = ${quoteIdentifier(targetName)}::regclass AS "targetMatches",
      con.confupdtype AS "updateAction",
      con.convalidated AS validated,
      local.attname AS "localColumn",
      foreign_field.attname AS "targetColumn"
    FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_attribute local ON local.attrelid = con.conrelid AND local.attnum = con.conkey[1]
    JOIN pg_catalog.pg_attribute foreign_field ON foreign_field.attrelid = con.confrelid AND
      foreign_field.attnum = con.confkey[1]
WHERE con.conname = ${name} AND con.conrelid = ${quoteIdentifier(entityName)}::regclass AND
  con.contype = 'f' AND
      cardinality(con.conkey) = 1 AND cardinality(con.confkey) = 1
  `
  const existing = rows[0]
  if (existing) {
    if (
      !existing.deferrable
      || existing.deferred
      || existing.deleteAction !== 'a'
      || existing.localColumn !== localColumn
      || existing.matchType !== 's'
      || existing.targetColumn !== targetColumn
      || !existing.targetMatches
      || existing.updateAction !== 'a'
      || !existing.validated
    ) {
      throw new Error(
        `Existing foreign key constraint "${name}" on "${entityName}" ` +
        'does not match the canonical model',
      )
    }
    return
  }
  await sql.unsafe(statement).simple()
}

/**
 * Build deterministic parent constraint name.
 * @param entity - Owning entity.
 * @returns Constraint name.
 */
function parentConstraintName(entity: EntityDefinition): string {
  return `${entity.name}_${entity.parent}_mti_fkey`
}

/**
 * Build deterministic reference constraint name.
 * @param entity - Owning entity.
 * @param field - Reference field.
 * @returns Constraint name.
 */
function constraintName(entity: EntityDefinition, field: EntityReferenceFieldDefinition): string {
  return `${entity.name}_${field.name}_fkey`
}

/**
 * Whether an index exists in the current schema.
 * @param sql - SQL client.
 * @param name - Index name.
 * @returns `true` when present.
 */
async function indexExists(sql: SQL, name: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname = current_schema() AND indexname
      = ${name} ) AS present
  `
  return rows[0]?.present === true
}

/**
 * Build lifecycle function and trigger metadata.
 * @param entities - Validated entities.
 * @returns Functions and triggers in dependency order.
 */
function lifecycleDefinitions(entities: readonly EntityDefinition[]): {
  readonly functions: readonly LifecycleFunction[],
  readonly triggers: readonly LifecycleTrigger[],
} {
  const concrete = entities.filter(entity => !entity.abstract)
  const leafChecks = concrete.map(entity => `when ${quoteLiteral(entity.name)} then
        if not exists (select 1 from ${quoteIdentifier(entity.name)} where "id" = root_id) then
          raise exception 'incomplete root row % for entity %', root_id, root_entity;
        end if;`)
  const rootBody = `
declare
  root_id text;
  root_entity text;
begin
  root_id := new."id";
  select "entity" into root_entity from "Entity" where "id" = root_id;
  if not found then
    return null;
  end if;
  case root_entity
    ${leafChecks.join('\n    ')}
    else
      raise exception 'unknown concrete entity %', root_entity;
  end case;
  return new;
end
`
  const leafBody = `
declare
  key text;
  root_entity text;
  leaf_present integer;
begin
  if tg_op = 'UPDATE'
    and to_jsonb(old)->>'id' is distinct from to_jsonb(new)->>'id' then
    raise exception 'leaf row identity is immutable';
  end if;
  if tg_op = 'DELETE' then
    key := to_jsonb(old)->>'id';
  else
    key := to_jsonb(new)->>'id';
  end if;
  execute format('select 1 from %I where "id" = $1', tg_table_name)
    into leaf_present using key;
  if leaf_present is not null then
    select "entity" into root_entity from "Entity" where "id" = key;
    if not found then
      raise exception 'leaf row % has no root row', key;
    end if;
    if root_entity is distinct from tg_table_name then
      raise exception 'leaf row % must match root entity %, found %',
        key, tg_table_name, root_entity;
    end if;
  elsif exists (
    select 1 from "Entity" where "id" = key and "entity" = tg_table_name
  ) then
    raise exception 'deleting leaf row % would leave an incomplete root row', key;
  end if;
  return null;
end
`
  const immutableBody = `
begin
  if new."entity" is distinct from old."entity" then
    raise exception 'leaf discriminator for root row % is immutable', old."id";
  end if;
  return new;
end
`
  const functions: LifecycleFunction[] = [
    lifecycleFunction('Entity_validate_leaf', rootBody),
    lifecycleFunction('Entity_validate_leaf_row', leafBody),
    lifecycleFunction('Entity_leaf_immutable', immutableBody),
  ]
  const triggers: LifecycleTrigger[] = [
    {
      constraint: true,
      deferrable: true,
      function: 'Entity_validate_leaf',
      initDeferred: true,
      name: 'Entity_leaf_check',
      statement: 'create constraint trigger "Entity_leaf_check" after insert or update on "Entity" ' +
        'deferrable initially deferred for each row execute function "Entity_validate_leaf"()',
      table: 'Entity',
      type: 21,
    },
    ...concrete.map(entity => ({
      constraint: true,
      deferrable: true,
      function: 'Entity_validate_leaf_row',
      initDeferred: true,
      name: `${entity.name}_leaf_check`,
      statement: `create constraint trigger ${quoteIdentifier(`${entity.name}_leaf_check`)} ` +
        `after insert or update or delete on ${quoteIdentifier(entity.name)} ` +
        'deferrable initially deferred for each row execute function "Entity_validate_leaf_row"()',
      table: entity.name,
      type: 29,
    })),
    {
      columns: ['entity'],
      constraint: false,
      deferrable: false,
      function: 'Entity_leaf_immutable',
      initDeferred: false,
      name: 'Entity_leaf_immutable',
      statement: 'create trigger "Entity_leaf_immutable" before update of "entity" on "Entity" ' +
        'for each row execute function "Entity_leaf_immutable"()',
      table: 'Entity',
      type: 19,
    },
  ]
  return { functions, triggers }
}

/**
 * Build one lifecycle function definition.
 * @param name - Function name.
 * @param body - Function body.
 * @returns Function metadata.
 */
function lifecycleFunction(name: string, body: string): LifecycleFunction {
  return {
    body,
    name,
    statement: `create or replace function ${quoteIdentifier(name)}() ` +
      `returns trigger language plpgsql as $$${body}$$`,
  }
}

/**
 * Build lifecycle DDL for a fresh schema.
 * @param entities - Validated entities.
 * @returns Function and trigger statements.
 */
function lifecycleStatements(entities: readonly EntityDefinition[]): readonly string[] {
  const definitions = lifecycleDefinitions(entities)
  return [
    ...definitions.functions.map(definition => definition.statement),
    ...definitions.triggers.map(definition => definition.statement),
  ]
}

/**
 * Resolve the physical PostgreSQL type for a scalar field.
 * @param type - Scalar field type.
 * @returns Column type declaration.
 */
function columnType(type: ScalarFieldType): string {
  switch (type) {
    case FieldType.Boolean: return 'boolean'
    case FieldType.Date: return 'date'
    case FieldType.ID: return 'text'
    case FieldType.Number: return 'double precision'
    case FieldType.String: return 'text'
    case FieldType.Timestamp: return 'timestamptz'
    default: throw new Error(`Unsupported field type: ${String(type)}`)
  }
}

/**
 * Whether a field is an entity reference.
 * @param field - Logical field.
 * @returns `true` for reference fields.
 */
function isReferenceField(field: FieldDefinition): field is EntityReferenceFieldDefinition {
  return field.type === FieldType.Entity
}

/**
 * Return the physical column for a logical field.
 * @param field - Logical field.
 * @returns Column name.
 */
function fieldColumn(field: FieldDefinition): string {
  return field.type === FieldType.Entity ? field.column : field.name
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Identifier.
 * @returns Quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * Quote a PostgreSQL string literal.
 * @param value - Literal value.
 * @returns Quoted literal.
 */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Whether a value is a plain object.
 * @param value - Candidate.
 * @returns `true` for a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reject unknown properties.
 * @param value - Object being validated.
 * @param allowed - Allowed keys.
 * @param context - Diagnostic label.
 */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`unknown ${context} property "${key}"`)
  }
}

/**
 * Build an invalid-definition error.
 * @param message - Specific failure.
 * @returns Error.
 */
function invalid(message: string): Error {
  return new Error(`Invalid entity definitions: ${message}`)
}
