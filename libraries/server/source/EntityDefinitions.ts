import type { SQL } from 'bun'

/**
 * Field types supported by the minimal canonical entity definitions.
 *
 * An enum keeps field identity distinct from type-specific hints and leaves
 * room for later non-scalar kinds without changing the field definition shape.
 */
export enum FieldType {
  /** Boolean value. */
  Boolean = 'boolean',
  /** Calendar date without a time of day. */
  Date = 'date',
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

/** One scalar field definition. */
export interface FieldDefinition {
  /** Field name, in camelCase. */
  readonly name: string,
  /** Whether this field is the entity's single primary key. */
  readonly primaryKey: boolean,
  /** Logical field type. */
  readonly type: FieldType,
}

/** One entity definition. */
export interface EntityDefinition {
  /** Fields in their declared order. */
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
   * Deterministic PostgreSQL DDL for the declared entities, in declaration
   * order. Identifiers are quoted; user values never enter these statements.
   * @returns One deterministic `CREATE TABLE` statement per entity.
   */
  get ddl(): readonly string[] {
    return this.entities.map(createTable)
  }

  /**
   * Create the declared tables in an explicitly empty/fresh database.
   *
   * This is a one-way creation path, not a migration planner. Existing tables
   * in the current schema are left untouched; an unexpected creation conflict
   * fails visibly rather than being silently accepted.
   * @param sql - The connected Bun SQL client.
   * @returns A promise that resolves after every table statement succeeds.
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

  const names = new Set<string>()
  const parsed = entities.map(parseEntity)
  for (const entity of parsed) {
    if (names.has(entity.name)) throw invalid(`duplicate entity "${entity.name}"`)
    names.add(entity.name)
  }
  return parsed
}

/**
 * Validate one entity definition.
 * @param value - Parsed entity candidate.
 * @returns The validated entity.
 */
function parseEntity(value: unknown): EntityDefinition {
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

  const primaryKeys = fields.filter(field => field.primaryKey)
  if (primaryKeys.length !== 1) {
    throw invalid(`entity "${value.name}" must define exactly one primary key`)
  }
  const primaryKey = primaryKeys[0] as FieldDefinition
  if (primaryKey.type !== FieldType.UUID && primaryKey.type !== FieldType.Snowflake) {
    throw invalid(`primary key "${value.name}.${primaryKey.name}" must be type uuid or snowflake`)
  }

  return { fields, name: value.name }
}

/**
 * Validate one field definition.
 * @param entityName - Owning entity name for diagnostics.
 * @param value - Parsed field candidate.
 * @returns The validated field.
 */
function parseField(entityName: string, value: unknown): FieldDefinition {
  if (!isRecord(value)) throw invalid(`field "${entityName}" must be an object`)
  assertKnownKeys(value, ['name', 'primaryKey', 'type'], 'field')

  if (typeof value.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid(`field name must be a camelCase identifier in "${entityName}"`)
  }
  if (typeof value.type !== 'string' || !FIELD_TYPES.has(value.type)) {
    throw invalid(`unsupported field type "${String(value.type)}" in "${entityName}.${value.name}"`)
  }
  if (value.primaryKey !== undefined && typeof value.primaryKey !== 'boolean') {
    throw invalid(`field "${entityName}.${value.name}" primaryKey must be a boolean`)
  }

  return {
    name: value.name,
    primaryKey: value.primaryKey === true,
    type: value.type as FieldType,
  }
}

/**
 * Build one entity's idempotent physical table statement.
 * @param entity - The validated entity.
 * @returns The PostgreSQL DDL statement.
 */
function createTable(entity: EntityDefinition): string {
  const columns = entity.fields.map(field => (
    `${quoteIdentifier(field.name)} ${columnType(field)}${field.primaryKey ? ' PRIMARY KEY' : ' NOT NULL'}`
  ))
  return `CREATE TABLE ${quoteIdentifier(entity.name)} (\n${columns.join(',\n')}\n)`
}

/**
 * Resolve the physical PostgreSQL type for a field.
 * @param field - The validated field.
 * @returns The column type declaration.
 */
function columnType(field: FieldDefinition): string {
  switch (field.type) {
    case FieldType.Boolean: return 'BOOLEAN'
    case FieldType.Date: return 'DATE'
    case FieldType.Number: return 'DOUBLE PRECISION'
    case FieldType.Snowflake: return 'BIGINT'
    case FieldType.String: return 'TEXT'
    case FieldType.Timestamp: return 'TIMESTAMPTZ'
    case FieldType.UUID: return 'UUID'
    default: throw new Error(`Unsupported field type: ${String(field.type)}`)
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

/** Field type names accepted by the entity definitions. */
const FIELD_TYPES = new Set<string>(Object.values(FieldType))

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
