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

/** One resolved many-to-one relationship. */
export interface RelationshipDefinition {
  /** Local foreign-key field name. */
  readonly field: string,
  /** Relationship name used by rooted graph paths. */
  readonly name: string,
  /** Referenced entity name. */
  readonly targetEntity: string,
  /** Referenced primary-key field name. */
  readonly targetField: string,
}

/** One entity definition. */
export interface EntityDefinition {
  /** Fields in their declared order. */
  readonly fields: readonly FieldDefinition[],
  /** Entity name, in PascalCase. */
  readonly name: string,
  /** Resolved many-to-one relationships, in field order. */
  readonly relationships: readonly RelationshipDefinition[],
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
   * Deterministic PostgreSQL DDL for the declared entities, ordered so each
   * referenced table exists before its foreign-key table. Identifiers are
   * quoted; user values never enter these statements.
   * @returns One deterministic `CREATE TABLE` statement per entity.
   * @throws {Error} When relationships form a cycle.
   */
  get ddl(): readonly string[] {
    return orderedEntities(this.entities).map(createTable)
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
    for (const entity of orderedEntities(this.entities)) {
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

  const seeds = entities.map(parseEntity)
  const byName = new Map<string, EntitySeed>()
  for (const seed of seeds) {
    if (byName.has(seed.name)) throw invalid(`duplicate entity "${seed.name}"`)
    byName.set(seed.name, seed)
  }
  return seeds.map(seed => resolveEntity(seed, byName))
}

/** One forward relationship declaration before resolution. */
interface ParsedRelationship {
  /** Local foreign-key field name. */
  readonly field: string,
  /** Navigation name on the declaring entity. */
  readonly name: string,
  /** Target entity name. */
  readonly target: string,
}

/** A parsed entity before its relationships are resolved. */
interface EntitySeed {
  /** Parsed fields in declaration order. */
  readonly fields: readonly FieldDefinition[],
  /** Entity name, in PascalCase. */
  readonly name: string,
  /** Forward relationship declarations. */
  readonly relationships: readonly ParsedRelationship[],
}

/**
 * Validate one entity definition's fields and primary key.
 * @param value - Parsed entity candidate.
 * @returns The entity seed awaiting relationship resolution.
 */
function parseEntity(value: unknown): EntitySeed {
  if (!isRecord(value)) throw invalid('entity must be an object')
  assertKnownKeys(value, ['fields', 'name', 'relationships'], 'entity')

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

  let relationships: readonly ParsedRelationship[] = []
  if (value.relationships !== undefined) {
    if (!Array.isArray(value.relationships)) {
      throw invalid(`entity "${value.name}" relationships must be an array`)
    }
    relationships = value.relationships.map(
      relationship => parseRelationship(value.name as string, relationship),
    )
  }

  return { fields, name: value.name, relationships }
}

/**
 * Validate one forward relationship declaration.
 * @param entityName - Owning entity name for diagnostics.
 * @param value - Parsed relationship candidate.
 * @returns The relationship declaration.
 */
function parseRelationship(entityName: string, value: unknown): ParsedRelationship {
  if (!isRecord(value)) throw invalid(`relationship in "${entityName}" must be an object`)
  assertKnownKeys(value, ['field', 'name', 'target'], 'relationship')

  if (typeof value.name !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid(`relationship name must be a camelCase identifier in "${entityName}"`)
  }
  if (typeof value.field !== 'string') {
    throw invalid(`relationship "${entityName}.${value.name}" field must be a string`)
  }
  if (typeof value.target !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.target)) {
    throw invalid(`relationship "${entityName}.${value.name}" target must be a PascalCase entity name`)
  }

  return { field: value.field, name: value.name, target: value.target }
}

/**
 * Resolve relationships for one parsed entity.
 * @param seed - Entity seed whose fields are validated.
 * @param byName - All parsed entities by name.
 * @returns The validated entity.
 */
function resolveEntity(
  seed: EntitySeed,
  byName: ReadonlyMap<string, EntitySeed>,
): EntityDefinition {
  const fieldNames = new Set(seed.fields.map(field => field.name))
  const relationshipNames = new Set<string>()
  const boundFields = new Set<string>()
  const relationships = seed.relationships.map(declaration => {
    if (relationshipNames.has(declaration.name)) {
      throw invalid(`duplicate relationship "${seed.name}.${declaration.name}"`)
    }
    if (fieldNames.has(declaration.name)) {
      throw invalid(`relationship "${seed.name}.${declaration.name}" collides with a scalar field`)
    }
    if (boundFields.has(declaration.field)) {
      throw invalid(`relationship field "${seed.name}.${declaration.field}" is bound more than once`)
    }
    relationshipNames.add(declaration.name)
    boundFields.add(declaration.field)
    return resolveRelationship(seed, declaration, byName)
  })

  return { fields: seed.fields, name: seed.name, relationships }
}

/**
 * Resolve one declared forward relationship.
 * @param seed - Owning entity seed.
 * @param declaration - Parsed relationship declaration.
 * @param byName - All parsed entities by name.
 * @returns The validated relationship.
 */
function resolveRelationship(
  seed: EntitySeed,
  declaration: ParsedRelationship,
  byName: ReadonlyMap<string, EntitySeed>,
): RelationshipDefinition {
  const field = seed.fields.find(candidate => candidate.name === declaration.field)
  if (!field) {
    throw invalid(
      `unknown local field "${seed.name}.${declaration.field}" ` +
      `for relationship "${seed.name}.${declaration.name}"`,
    )
  }
  if (field.primaryKey) {
    throw invalid(`relationship field "${seed.name}.${field.name}" cannot be a primary key`)
  }

  const target = byName.get(declaration.target)
  if (!target) {
    throw invalid(
      `unknown target entity "${declaration.target}" for relationship "${seed.name}.${declaration.name}"`,
    )
  }
  const targetKey = target.fields.find(candidate => candidate.primaryKey)
  if (!targetKey) throw invalid(`target entity "${target.name}" must define a primary key`)
  if (field.type !== targetKey.type) {
    throw invalid(
      `relationship field "${seed.name}.${field.name}" type ${field.type} ` +
      `must match primary key "${target.name}.${targetKey.name}" type ${targetKey.type}`,
    )
  }

  return {
    field: field.name,
    name: declaration.name,
    targetEntity: target.name,
    targetField: targetKey.name,
  }
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
 * Order entities so every referenced table precedes its foreign-key table.
 * @param entities - Validated entities in declaration order.
 * @returns Entities in deterministic dependency order.
 * @throws {Error} When relationships form a cycle.
 */
function orderedEntities(entities: readonly EntityDefinition[]): readonly EntityDefinition[] {
  const byName = new Map(entities.map(entity => [entity.name, entity]))
  const ordered: EntityDefinition[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (entity: EntityDefinition, path: readonly string[]): void => {
    if (visited.has(entity.name)) return
    if (visiting.has(entity.name)) {
      throw invalid(`circular relationship ${[...path, entity.name].join(' -> ')}`)
    }
    visiting.add(entity.name)
    for (const relationship of entity.relationships) {
      if (relationship.targetEntity === entity.name) continue
      const target = byName.get(relationship.targetEntity)
      if (!target) throw invalid(`unknown referenced entity "${relationship.targetEntity}"`)
      visit(target, [...path, entity.name])
    }
    visiting.delete(entity.name)
    visited.add(entity.name)
    ordered.push(entity)
  }

  for (const entity of entities) visit(entity, [])
  return ordered
}

/**
 * Build one entity's idempotent physical table statement.
 * @param entity - The validated entity.
 * @returns The PostgreSQL DDL statement.
 */
function createTable(entity: EntityDefinition): string {
  const relationships = new Map(entity.relationships.map(relationship => [relationship.field, relationship]))
  const columns = entity.fields.map(field => {
    const nullability = field.primaryKey ? ' PRIMARY KEY' : ' NOT NULL'
    const column = `${quoteIdentifier(field.name)} ${columnType(field)}${nullability}`
    const relationship = relationships.get(field.name)
    if (!relationship) return column
    return `${column} REFERENCES ${quoteIdentifier(relationship.targetEntity)} ` +
      `(${quoteIdentifier(relationship.targetField)})`
  })
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
