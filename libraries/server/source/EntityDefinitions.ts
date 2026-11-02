import type { SQL } from 'bun'

/**
 * Logical field kinds supported by the canonical entity definitions.
 *
 * `Entity` is the singular reference kind; every other value is a scalar type.
 * Keeping both in one field shape lets callers discriminate references without
 * a parallel relationship registry.
 */
export enum FieldType {
  /** Boolean value. */
  Boolean = 'boolean',
  /** Calendar date without a time of day. */
  Date = 'date',
  /** Singular reference to another entity. */
  Entity = 'entity',
  /** Numeric value, including integers and floating point numbers. */
  Number = 'number',
  /**
   * Externally assigned signed 64-bit identifier. Values are exact integers
   * (`bigint` in TypeScript) and decimal strings at JSON boundaries.
   */
  Snowflake = 'snowflake',
  /** Text value. */
  String = 'string',
  /** Instant in time. */
  Timestamp = 'timestamp',
  /** UUID identifier. */
  UUID = 'uuid',
}

/** Field types that represent scalar values. */
export type ScalarFieldType =
  | FieldType.Boolean
  | FieldType.Date
  | FieldType.Number
  | FieldType.Snowflake
  | FieldType.String
  | FieldType.Timestamp
  | FieldType.UUID

/** One scalar field definition. */
export interface ScalarFieldDefinition {
  /** Field name, in camelCase. */
  readonly name: string,
  /** Whether this field is the entity's single primary key. */
  readonly primaryKey: boolean,
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
  /** Referenced primary-key field name. */
  readonly targetField: string,
  /** Referenced primary-key scalar type. */
  readonly targetType: FieldType.Snowflake | FieldType.UUID,
  /** Field-kind discriminator. */
  readonly type: FieldType.Entity,
}

/** One logical entity field. */
export type FieldDefinition = ScalarFieldDefinition | EntityReferenceFieldDefinition

/** One entity definition. */
export interface EntityDefinition {
  /** Logical fields in their declared order. */
  readonly fields: readonly FieldDefinition[],
  /** Entity name, in PascalCase. */
  readonly name: string,
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
   * Find an entity by name.
   * @param name - Exact entity name.
   * @returns The entity, or undefined when absent.
   */
  entity(name: string): EntityDefinition | undefined {
    return this.entities.find(entity => entity.name === name)
  }

  /**
   * Deterministic PostgreSQL DDL for the declared entities.
   *
   * Every table and column is created first, in declaration order; foreign-key
   * constraints are added afterward with `ALTER TABLE`. This supports cyclic
   * and self-referential references without ordering cycles. Identifiers are
   * quoted; user values never enter these statements.
   * @returns The complete ordered DDL sequence.
   */
  get ddl(): readonly string[] {
    return [
      ...this.entities.map(createTable),
      ...this.entities.flatMap(entity => entity.fields
        .filter(isReferenceField)
        .map(field => addConstraint(entity, field))),
    ]
  }

  /**
   * Create missing tables, then add missing foreign-key constraints.
   *
   * Existing tables are left untouched, but declared constraints are still
   * reconciled: a missing constraint is added and a mismatched existing
   * constraint fails visibly. This is a fresh-initialization path, not a
   * migration planner.
   * @param sql - The connected Bun SQL client.
   * @returns A promise that resolves after every table and constraint succeeds.
   * @throws {Error} When a constraint is missing a valid target or an existing
   *   constraint does not match the canonical model.
   */
  async createTables(sql: SQL): Promise<void> {
    for (const entity of this.entities) {
      const rows = await sql<{ present: boolean }[]>`
        select exists (
          select 1
          from pg_catalog.pg_tables
          where schemaname = current_schema()
            and tablename = ${entity.name}
        ) as present
      `
      if (rows[0]?.present) continue
      await sql.unsafe(createTable(entity)).simple()
    }

    for (const entity of this.entities) {
      for (const field of entity.fields.filter(isReferenceField)) {
        const name = constraintName(entity, field)
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
          select
            con.condeferrable as deferrable,
            con.condeferred as deferred,
            con.confdeltype as "deleteAction",
            con.confmatchtype as "matchType",
            con.confrelid = ${quoteIdentifier(field.target)}::regclass as "targetMatches",
            con.confupdtype as "updateAction",
            con.convalidated as validated,
            local.attname as "localColumn",
            foreign_field.attname as "targetColumn"
          from pg_catalog.pg_constraint con
          join pg_catalog.pg_attribute local
            on local.attrelid = con.conrelid and local.attnum = con.conkey[1]
          join pg_catalog.pg_attribute foreign_field
            on foreign_field.attrelid = con.confrelid and foreign_field.attnum = con.confkey[1]
          where con.conname = ${name}
            and con.conrelid = ${quoteIdentifier(entity.name)}::regclass
            and con.contype = 'f'
            and cardinality(con.conkey) = 1
            and cardinality(con.confkey) = 1
        `
        const existing = rows[0]
        if (existing) {
          if (
            !existing.deferrable
            || existing.deferred
            || existing.deleteAction !== 'a'
            || existing.localColumn !== field.column
            || existing.matchType !== 's'
            || existing.targetColumn !== field.targetField
            || !existing.targetMatches
            || existing.updateAction !== 'a'
            || !existing.validated
          ) {
            throw new Error(
              `Existing foreign key constraint "${name}" on "${entity.name}" ` +
              'does not match the canonical model',
            )
          }
          continue
        }
        await sql.unsafe(addConstraint(entity, field)).simple()
      }
    }
  }
}

/**
 * Validate the parsed entity document root.
 * @param value - Parsed JSON value.
 * @returns Validated entities.
 */
function parseEntities(value: unknown): readonly EntityDefinition[] {
  if (!isRecord(value)) throw invalid('entity definitions must be an object')
  assertKnownKeys(value, ['entities'], 'top-level')

  const entities = value.entities
  if (!Array.isArray(entities) || entities.length === 0) {
    throw invalid('entities must be a non-empty array')
  }

  const seeds = entities.map(parseEntity)
  const byName = new Map<string, EntitySeed>()
  for (const seed of seeds) {
    if (byName.has(seed.name)) throw invalid(`duplicate entity "${seed.name}"`)
    byName.set(seed.name, seed)
  }
  return seeds.map(seed => resolveEntity(seed, byName))
}

/** A parsed entity-reference field before its target key is resolved. */
interface ParsedReferenceField {
  /** Explicit physical column name. */
  readonly column: string,
  /** Logical field name. */
  readonly name: string,
  /** Referenced entity name. */
  readonly target: string,
  /** Field-kind discriminator. */
  readonly type: FieldType.Entity,
}

/** A parsed scalar field. */
type ParsedScalarField = ScalarFieldDefinition

/** A parsed logical field. */
type ParsedField = ParsedReferenceField | ParsedScalarField

/** A parsed entity before reference targets are resolved. */
interface EntitySeed {
  /** Parsed fields in declaration order. */
  readonly fields: readonly ParsedField[],
  /** Entity name, in PascalCase. */
  readonly name: string,
  /** The entity's explicitly marked scalar primary key. */
  readonly primaryKey: ParsedScalarField,
}

/**
 * Validate one entity definition's fields and primary key.
 * @param value - Parsed entity candidate.
 * @returns The entity seed awaiting reference resolution.
 */
function parseEntity(value: unknown): EntitySeed {
  if (!isRecord(value)) throw invalid('entity must be an object')
  assertKnownKeys(value, ['fields', 'name'], 'entity')

  if (typeof value.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid('entity name must be a PascalCase identifier')
  }

  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    throw invalid(`entity "${value.name}" must define a non-empty fields array`)
  }

  const names = new Set<string>()
  const fields = value.fields.map(field => parseField(value.name as string, field))
  for (const field of fields) {
    if (names.has(field.name)) throw invalid(`duplicate field "${value.name}.${field.name}"`)
    names.add(field.name)
  }

  const primaryKeys = fields.filter(isScalarField).filter(field => field.primaryKey)
  if (primaryKeys.length !== 1) {
    throw invalid(`entity "${value.name}" must define exactly one primary key`)
  }
  const primaryKey = primaryKeys[0] as ParsedScalarField
  if (primaryKey.type !== FieldType.UUID && primaryKey.type !== FieldType.Snowflake) {
    throw invalid(`primary key "${value.name}.${primaryKey.name}" must be type uuid or snowflake`)
  }

  return { fields, name: value.name, primaryKey }
}

/**
 * Resolve reference targets for one parsed entity.
 * @param seed - Entity seed whose fields are validated.
 * @param byName - All parsed entities by name.
 * @returns The validated entity.
 */
function resolveEntity(
  seed: EntitySeed,
  byName: ReadonlyMap<string, EntitySeed>,
): EntityDefinition {
  const fields = seed.fields.map(field => resolveField(seed.name, field, byName))
  const columns = new Map<string, string>()
  for (const field of fields) {
    const column = field.type === FieldType.Entity ? field.column : field.name
    const existing = columns.get(column)
    if (existing) {
      throw invalid(
        `physical column "${column}" is declared by both "${seed.name}.${existing}" ` +
        `and "${seed.name}.${field.name}"`,
      )
    }
    columns.set(column, field.name)
  }
  return { fields, name: seed.name }
}

/**
 * Resolve one parsed field.
 * @param entityName - Owning entity name for diagnostics.
 * @param field - Parsed field.
 * @param byName - All parsed entities by name.
 * @returns The resolved logical field.
 */
function resolveField(
  entityName: string,
  field: ParsedField,
  byName: ReadonlyMap<string, EntitySeed>,
): FieldDefinition {
  if (field.type !== FieldType.Entity) return field

  const target = byName.get(field.target)
  if (!target) {
    throw invalid(`unknown target entity "${field.target}" for field "${entityName}.${field.name}"`)
  }
  return {
    column: field.column,
    name: field.name,
    target: target.name,
    targetField: target.primaryKey.name,
    targetType: target.primaryKey.type as FieldType.Snowflake | FieldType.UUID,
    type: FieldType.Entity,
  }
}

/**
 * Whether a parsed or resolved field is scalar.
 * @param field - Field candidate.
 * @returns `true` for scalar fields.
 */
function isScalarField(
  field: FieldDefinition | ParsedField,
): field is ParsedScalarField | ScalarFieldDefinition {
  return field.type !== FieldType.Entity
}

/**
 * Validate one field definition.
 * @param entityName - Owning entity name for diagnostics.
 * @param value - Parsed field candidate.
 * @returns The validated field.
 */
function parseField(entityName: string, value: unknown): ParsedField {
  if (!isRecord(value)) throw invalid(`field "${entityName}" must be an object`)
  if (typeof value.type !== 'string') {
    throw invalid(`field "${entityName}.${String(value.name)}" type must be a string`)
  }
  if (value.type === FieldType.Entity) {
    assertKnownKeys(value, ['column', 'name', 'target', 'type'], 'field')
    if (typeof value.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.name)) {
      throw invalid(`field name must be a camelCase identifier in "${entityName}"`)
    }
    if (typeof value.target !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.target)) {
      throw invalid(`reference field "${entityName}.${value.name}" target must be a PascalCase entity name`)
    }
    if (typeof value.column !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.column)) {
      throw invalid(`reference field "${entityName}.${value.name}" column must be a camelCase identifier`)
    }
    return {
      column: value.column,
      name: value.name,
      target: value.target,
      type: FieldType.Entity,
    }
  }

  assertKnownKeys(value, ['name', 'primaryKey', 'type'], 'field')
  if (typeof value.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid(`field name must be a camelCase identifier in "${entityName}"`)
  }
  if (!SCALAR_FIELD_TYPES.has(value.type)) {
    throw invalid(`unsupported field type "${String(value.type)}" in "${entityName}.${value.name}"`)
  }
  if (value.primaryKey !== undefined && typeof value.primaryKey !== 'boolean') {
    throw invalid(`field "${entityName}.${value.name}" primaryKey must be a boolean`)
  }

  return {
    name: value.name,
    primaryKey: value.primaryKey === true,
    type: value.type as ScalarFieldType,
  }
}

/**
 * Build one entity's idempotent physical table statement.
 * @param entity - The validated entity.
 * @returns The PostgreSQL DDL statement.
 */
function createTable(entity: EntityDefinition): string {
  const columns = entity.fields.map(field => {
    if (field.type === FieldType.Entity) {
      return `${quoteIdentifier(field.column)} ${columnType(field.targetType)} NOT NULL`
    }
    const nullability = field.primaryKey ? ' PRIMARY KEY' : ' NOT NULL'
    return `${quoteIdentifier(field.name)} ${columnType(field.type)}${nullability}`
  })
  return `CREATE TABLE ${quoteIdentifier(entity.name)} (\n${columns.join(',\n')}\n)`
}

/**
 * Build one foreign-key constraint statement.
 * @param entity - Owning entity.
 * @param field - Resolved entity-reference field.
 * @returns The `ALTER TABLE` statement.
 */
function addConstraint(entity: EntityDefinition, field: EntityReferenceFieldDefinition): string {
  return `ALTER TABLE ${quoteIdentifier(entity.name)} ` +
    `ADD CONSTRAINT ${quoteIdentifier(constraintName(entity, field))} ` +
    `FOREIGN KEY (${quoteIdentifier(field.column)}) ` +
    `REFERENCES ${quoteIdentifier(field.target)} (${quoteIdentifier(field.targetField)}) ` +
    'DEFERRABLE INITIALLY IMMEDIATE'
}

/**
 * Build one deterministic foreign-key constraint name.
 * @param entity - Owning entity.
 * @param field - Resolved entity-reference field.
 * @returns The constraint name.
 */
function constraintName(entity: EntityDefinition, field: EntityReferenceFieldDefinition): string {
  return `${entity.name}_${field.name}_fkey`
}

/**
 * Whether a field is an entity reference.
 * @param field - Logical field.
 * @returns `true` for entity-reference fields.
 */
function isReferenceField(field: FieldDefinition): field is EntityReferenceFieldDefinition {
  return field.type === FieldType.Entity
}

/**
 * Resolve the physical PostgreSQL type for a scalar field.
 * @param type - Scalar field type.
 * @returns The column type declaration.
 */
function columnType(type: ScalarFieldType): string {
  switch (type) {
    case FieldType.Boolean: return 'BOOLEAN'
    case FieldType.Date: return 'DATE'
    case FieldType.Number: return 'DOUBLE PRECISION'
    case FieldType.Snowflake: return 'BIGINT'
    case FieldType.String: return 'TEXT'
    case FieldType.Timestamp: return 'TIMESTAMPTZ'
    case FieldType.UUID: return 'UUID'
    default: throw new Error(`Unsupported field type: ${String(type)}`)
  }
}

/**
 * Quote a PostgreSQL identifier. Validated model names contain no quotes, but
 * quoting at the boundary keeps the DDL safe if the vocabulary expands.
 * @param identifier - Entity or field name.
 * @returns The quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/** Scalar field type names accepted by the entity definitions. */
const SCALAR_FIELD_TYPES = new Set<string>([
  FieldType.Boolean,
  FieldType.Date,
  FieldType.Number,
  FieldType.Snowflake,
  FieldType.String,
  FieldType.Timestamp,
  FieldType.UUID,
])

/**
 * Whether a value is a plain object.
 * @param value - Candidate value.
 * @returns `true` for a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reject properties outside the entity vocabulary.
 * @param value - Object being validated.
 * @param allowed - Accepted keys.
 * @param context - Label used in diagnostics.
 */
function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`unknown ${context} property "${key}"`)
  }
}

/**
 * Build an invalid-entity error.
 * @param message - Specific validation failure.
 * @returns The error to throw.
 */
function invalid(message: string): Error {
  return new Error(`Invalid entity definitions: ${message}`)
}
