import type { SQL } from 'bun'

/** Enable PostgreSQL trigram search for universal names. */
const IDENTITY_EXTENSION_DDL = 'create extension if not exists pg_trgm with schema public'

/**
 * Canonical field types.
 *
 * `Entity` is the singular reference kind. `Array` holds scalar values in a
 * native PostgreSQL array. `JSON` is an opaque structured value. Entity
 * collections are navigations derived from inverse references or named
 * top-level relationships, never authored as fields.
 */
export enum FieldType {
  /** Native scalar array. */
  Array = 'Array',
  /** Boolean value. */
  Boolean = 'Boolean',
  /** Calendar date without a time of day. */
  Date = 'Date',
  /** Singular reference to another entity. */
  Entity = 'Entity',
  /** Universal text identity. */
  ID = 'ID',
  /** Opaque JSON value. */
  JSON = 'JSON',
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

/** One scalar element in a native array field. */
export interface ScalarArrayElementDefinition {
  /** Optional identity format for ID elements. */
  readonly format?: IdentityFormat,
  /** Scalar element type. */
  readonly type: ScalarFieldType,
}

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
  /** Derived physical column name, always `field + '.id'`. */
  readonly column: string,
  /** Derived collection name exposed on the target entity. */
  readonly inverse?: string,
  /** Logical field name used by entity-rooted queries. */
  readonly name: string,
  /** Referenced entity name. */
  readonly target: string,
  /** Field-kind discriminator. */
  readonly type: FieldType.Entity,
}

/** One opaque JSON field. */
export interface JSONFieldDefinition {
  /** Logical field name used by entity-rooted queries. */
  readonly name: string,
  /** Field-kind discriminator. */
  readonly type: FieldType.JSON,
}

/** One native scalar-array field. */
export interface ArrayFieldDefinition {
  /** Scalar element descriptor. */
  readonly items: ScalarArrayElementDefinition,
  /** Logical field name used by entity-rooted queries. */
  readonly name: string,
  /** Field-kind discriminator. */
  readonly type: FieldType.Array,
}

/** One logical entity field. */
export type FieldDefinition =
  | ArrayFieldDefinition
  | JSONFieldDefinition
  | ScalarFieldDefinition
  | EntityReferenceFieldDefinition

/** One endpoint of a named relationship. */
export interface RelationshipEndpointDefinition {
  /** Local endpoint column name, in camelCase. */
  readonly field: string,
  /** Derived navigation name exposed on the target entity. */
  readonly inverse: string,
  /** Referenced entity or supported ancestor. */
  readonly target: string,
}

/** A property owned by a named relationship rather than either endpoint. */
export type RelationshipFieldDefinition =
  | ArrayFieldDefinition
  | JSONFieldDefinition
  | ScalarFieldDefinition

/** One named, first-class many-to-many relationship. */
export interface RelationshipDefinition {
  /** The two endpoint descriptors in authored order. */
  readonly between: readonly [RelationshipEndpointDefinition, RelationshipEndpointDefinition],
  /** Properties owned by the relationship itself. */
  readonly fields: readonly RelationshipFieldDefinition[],
  /** Relationship name, in PascalCase. */
  readonly name: string,
}

/** A collection navigation derived from an inverse reference. */
export interface InverseDerivedCollectionDefinition {
  /** Derivation-kind discriminator. */
  readonly kind: 'inverse',
  /** Navigation name exposed on the target entity. */
  readonly name: string,
  /** The singular forward reference that owns this navigation. */
  readonly reference: EntityReferenceFieldDefinition,
  /** Entity type returned by the navigation. */
  readonly target: string,
}

/** A collection navigation derived from one relationship endpoint. */
export interface RelationshipDerivedCollectionDefinition {
  /** Authored endpoint index that owns this navigation. */
  readonly endpoint: 0 | 1,
  /** Derivation-kind discriminator. */
  readonly kind: 'relationship',
  /** Navigation name exposed on the target entity. */
  readonly name: string,
  /** The named relationship that owns this navigation. */
  readonly relationship: RelationshipDefinition,
  /** Entity type returned by the navigation. */
  readonly target: string,
}

/** One collection navigation available in the query model. */
export type DerivedCollectionDefinition =
  | InverseDerivedCollectionDefinition
  | RelationshipDerivedCollectionDefinition

/** One effective inherited field and its owning entity table. */
export type EffectiveFieldDefinition = FieldDefinition & {
  /** Entity table that physically owns this field. */
  readonly owner: string,
}

/** One entity definition. */
export interface EntityDefinition {
  /** Whether this entity has descendants and cannot be a concrete leaf. */
  readonly abstract: boolean,
  /** Derived inverse and relationship navigations exposed on this entity. */
  readonly collections: readonly DerivedCollectionDefinition[],
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
  /** Element type for native array columns. */
  readonly arrayType?: ScalarFieldType,
  /** Physical column name. */
  readonly name: string,
  /** Whether this column accepts NULL. */
  readonly nullable?: boolean,
  /** Whether this column is the table's primary key. */
  readonly primaryKey?: boolean,
  /** Physical column type. */
  readonly type: ScalarFieldType | FieldType.Array | FieldType.JSON,
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
  /** Table-level composite primary key columns, when not a single column key. */
  readonly primaryKey?: readonly string[],
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
 * Create a synthetic definition for the universal identity root.
 * @returns Canonical root identity metadata.
 */
export function identityDefinition(): EntityDefinition {
  return {
    abstract: false,
    collections: [],
    effectiveFields: rootFields(undefined),
    fields: [],
    name: 'Entity',
    parent: 'Entity',
  }
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
  /** Named first-class relationships in their declared order. */
  readonly relationships: readonly RelationshipDefinition[]
  /** Derived navigations exposed by the universal identity root. */
  readonly #rootCollections: readonly DerivedCollectionDefinition[]

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
    const document = parseEntityDocument(value)
    return new EntityDefinitions(document.entities, document.relationships, document.rootCollections)
  }

  /**
   * Creates entity definitions from already-validated definitions.
   * @param entities - Validated entity definitions.
   * @param relationships - Named relationship definitions.
   * @param rootCollections - Navigations exposed by the universal identity root.
   */
  private constructor(
    entities: readonly EntityDefinition[],
    relationships: readonly RelationshipDefinition[],
    rootCollections: readonly DerivedCollectionDefinition[],
  ) {
    this.entities = entities
    this.relationships = relationships
    this.#rootCollections = rootCollections
  }

  /**
   * Resolve the physical tables for the identity root, entities and relationships.
   * @returns System-owned root followed by model-owned tables in order.
   */
  private get tables(): readonly TableDefinition[] {
    const inverseIndexes = inverseReferenceIndexes(this.entities)
    return [
      identityRoot(this.entities),
      ...this.entities.map(entity => entityTable(entity, inverseIndexes.get(entity.name) ?? [])),
      ...this.relationships.map(relationshipTable),
    ]
  }

  /**
   * Resolve derived collection navigations exposed by one entity.
   * @param name - Exact entity name, or `Entity` for the universal root.
   * @returns Derived navigations in canonical order.
   */
  collections(name: string): readonly DerivedCollectionDefinition[] {
    return name === 'Entity'
      ? this.#rootCollections
      : this.entity(name)?.collections ?? []
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
   * Find a named relationship.
   * @param name - Exact relationship name.
   * @returns The relationship, or undefined when absent.
   */
  relationship(name: string): RelationshipDefinition | undefined {
    return this.relationships.find(relationship => relationship.name === name)
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
      ...this.relationships.flatMap(relationshipConstraints),
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
    for (const relationship of this.relationships) {
      for (const constraint of relationshipForeignKeyDefinitions(relationship)) {
        await reconcileForeignKey(
          sql,
          relationship.name,
          constraint.name,
          constraint.column,
          constraint.target,
          'id',
          constraint.statement,
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

/** Parsed canonical document, including derived navigations. */
interface ParsedEntityDocument {
  /** Resolved entities in declaration order. */
  readonly entities: readonly EntityDefinition[],
  /** Named relationships in declaration order. */
  readonly relationships: readonly RelationshipDefinition[],
  /** Derived navigations exposed by the universal identity root. */
  readonly rootCollections: readonly DerivedCollectionDefinition[],
}

/**
 * Validate the parsed entity document root.
 * @param value - Parsed JSON value.
 * @returns Validated entities, relationships and navigations.
 */
function parseEntityDocument(value: unknown): ParsedEntityDocument {
  if (!isRecord(value)) throw invalid('entity definitions must be an object')
  assertKnownKeys(value, ['entities', 'relationships'], 'top-level')
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
      if (field.type !== FieldType.Entity) continue
      if (field.target !== 'Entity' && !byName.has(field.target)) {
        throw invalid(`unknown target entity "${field.target}" for field "${seed.name}.${field.name}"`)
      }
    }
  }
  const formats = effectiveFormats(byName)
  const children = childrenByEntity(seeds)
  const resolved = seeds.map(seed => resolveEntity(seed, byName, formats, children))
  const relationships = parseRelationships(value.relationships, byName)
  validateRelationshipPhysicalNames(relationships)
  const collections = deriveCollections(resolved, relationships)
  return {
    entities: resolved.map(entity => ({
      ...entity,
      collections: collections.get(entity.name) ?? [],
    })),
    relationships,
    rootCollections: collections.get('Entity') ?? [],
  }
}

/**
 * Validate named relationships against the resolved entity graph.
 * @param value - Optional relationship array.
 * @param byName - Parsed entities by name.
 * @returns Validated relationship definitions.
 */
function parseRelationships(
  value: unknown,
  byName: ReadonlyMap<string, EntitySeed>,
): readonly RelationshipDefinition[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw invalid('relationships must be an array')
  const names = new Set<string>()
  return value.map(candidate => {
    const relationship = parseRelationship(candidate, byName)
    if (relationship.name === 'Entity' || byName.has(relationship.name)) {
      throw invalid(`relationship "${relationship.name}" conflicts with an entity name`)
    }
    if (names.has(relationship.name)) {
      throw invalid(`duplicate relationship "${relationship.name}"`)
    }
    names.add(relationship.name)
    return relationship
  })
}

/**
 * Reject colliding generated relationship index and constraint identifiers.
 * @param relationships - Validated named relationships.
 */
function validateRelationshipPhysicalNames(
  relationships: readonly RelationshipDefinition[],
): void {
  const indexes = new Set<string>()
  const constraints = new Set<string>()
  for (const relationship of relationships) {
    for (const endpoint of relationship.between) {
      const index = `${relationship.name}_${endpoint.field}_idx`
      if (indexes.has(index)) {
        throw invalid(`relationship physical index "${index}" is not unique`)
      }
      indexes.add(index)
      const constraint = `${relationship.name}_${endpoint.field}_fkey`
      if (constraints.has(constraint)) {
        throw invalid(`relationship physical constraint "${constraint}" is not unique`)
      }
      constraints.add(constraint)
    }
  }
}

/**
 * Validate one named relationship.
 * @param value - Relationship candidate.
 * @param byName - Parsed entities by name.
 * @returns The validated relationship.
 */
function parseRelationship(
  value: unknown,
  byName: ReadonlyMap<string, EntitySeed>,
): RelationshipDefinition {
  if (!isRecord(value)) throw invalid('relationship must be an object')
  assertKnownKeys(value, ['between', 'fields', 'name'], 'relationship')
  if (typeof value.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid('relationship name must be a PascalCase identifier')
  }
  const name = value.name
  validatePhysicalIdentifier(name, 'relationship table')
  if (!Array.isArray(value.between) || value.between.length !== 2) {
    throw invalid(`relationship "${name}" between must contain exactly two endpoints`)
  }
  const first = parseRelationshipEndpoint(name, value.between[0], byName)
  const second = parseRelationshipEndpoint(name, value.between[1], byName)
  if (first.field === second.field) {
    throw invalid(`relationship "${name}" endpoint fields must differ`)
  }
  if (first.inverse === second.inverse) {
    throw invalid(`relationship "${name}" endpoint inverse names must differ`)
  }
  if (!Array.isArray(value.fields)) {
    throw invalid(`relationship "${name}" must define a fields array`)
  }
  const fieldNames = new Set<string>()
  const fields = value.fields.map(candidate => {
    const field = parseRelationshipField(name, candidate)
    if (fieldNames.has(field.name)) {
      throw invalid(`duplicate field "${name}.${field.name}"`)
    }
    fieldNames.add(field.name)
    validatePhysicalIdentifier(field.name, `relationship "${name}" field`)
    return field
  })
  return { between: [first, second], fields, name }
}

/**
 * Validate one relationship endpoint.
 * @param relationshipName - Owning relationship name.
 * @param value - Endpoint candidate.
 * @param byName - Parsed entities by name.
 * @returns The validated endpoint.
 */
function parseRelationshipEndpoint(
  relationshipName: string,
  value: unknown,
  byName: ReadonlyMap<string, EntitySeed>,
): RelationshipEndpointDefinition {
  if (!isRecord(value)) {
    throw invalid(`relationship "${relationshipName}" endpoint must be an object`)
  }
  assertKnownKeys(value, ['field', 'inverse', 'target'], 'relationship endpoint')
  if (typeof value.field !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.field)) {
    throw invalid(`relationship "${relationshipName}" endpoint field must be a camelCase identifier`)
  }
  if (typeof value.inverse !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.inverse)) {
    throw invalid(`relationship "${relationshipName}" endpoint inverse must be a camelCase identifier`)
  }
  if (typeof value.target !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.target)) {
    throw invalid(`relationship "${relationshipName}" endpoint target must be a PascalCase entity name`)
  }
  if (value.target !== 'Entity' && !byName.has(value.target)) {
    throw invalid(
      `unknown target entity "${value.target}" for relationship "${relationshipName}" ` +
      `endpoint "${value.field}"`,
    )
  }
  validatePhysicalIdentifier(`${value.field}.id`, `relationship "${relationshipName}" endpoint column`)
  validatePhysicalIdentifier(`${relationshipName}_${value.field}_fkey`, `relationship "${relationshipName}" constraint`)
  validatePhysicalIdentifier(`${relationshipName}_${value.field}_idx`, `relationship "${relationshipName}" index`)
  return { field: value.field, inverse: value.inverse, target: value.target }
}

/**
 * Validate one property owned by a named relationship.
 * @param relationshipName - Owning relationship name.
 * @param value - Field candidate.
 * @returns The validated relationship field.
 */
function parseRelationshipField(
  relationshipName: string,
  value: unknown,
): RelationshipFieldDefinition {
  const parsed = parseField(relationshipName, value)
  if ('idRefinement' in parsed) {
    throw invalid(`relationship "${relationshipName}" may not declare an id refinement`)
  }
  if (parsed.field.type === FieldType.Entity) {
    throw invalid(
      `relationship field "${relationshipName}.${parsed.field.name}" must be a scalar, array or JSON field`,
    )
  }
  if (parsed.field.name === 'id') {
    throw invalid(`relationship "${relationshipName}" may not declare a field named "id"`)
  }
  return parsed.field
}

/**
 * Derive reverse 1:N and relationship navigations from canonical metadata.
 * @param entities - Resolved entity graph.
 * @param relationships - Named relationships.
 * @returns Effective navigations by exposing entity name.
 */
function deriveCollections(
  entities: readonly EntityDefinition[],
  relationships: readonly RelationshipDefinition[],
): ReadonlyMap<string, readonly DerivedCollectionDefinition[]> {
  const byName = new Map(entities.map(entity => [entity.name, entity]))
  const fields = new Map<string, Set<string>>([
    ['Entity', new Set(['id', 'name', 'entity'])],
  ])
  for (const entity of entities) {
    fields.set(entity.name, new Set(entity.effectiveFields.map(field => field.name)))
  }
  const direct = new Map<string, DerivedCollectionDefinition[]>()
  const addDirect = (owner: string, collection: DerivedCollectionDefinition): void => {
    const names = fields.get(owner)
    if (!names) throw invalid(`derived navigation target entity "${owner}" is not declared`)
    if (names.has(collection.name)) {
      throw invalid(`derived navigation "${owner}.${collection.name}" conflicts with a field`)
    }
    const existing = direct.get(owner) ?? []
    if (existing.some(candidate => candidate.name === collection.name)) {
      throw invalid(`duplicate derived navigation "${owner}.${collection.name}"`)
    }
    existing.push(collection)
    direct.set(owner, existing)
  }
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (field.type !== FieldType.Entity || field.inverse === undefined) continue
      validatePhysicalIdentifier(
        `${entity.name}_${field.name}_fk_idx`,
        `inverse index for "${field.target}.${field.inverse}"`,
      )
      addDirect(field.target, {
        kind: 'inverse',
        name: field.inverse,
        reference: field,
        target: entity.name,
      })
    }
  }
  for (const relationship of relationships) {
    const endpoints = relationship.between
    for (const index of [0, 1] as const) {
      const endpoint = endpoints[index]
      const remote = endpoints[index === 0 ? 1 : 0]
      addDirect(endpoint.target, {
        endpoint: index,
        kind: 'relationship',
        name: endpoint.inverse,
        relationship,
        target: remote.target,
      })
    }
  }

  const result = new Map<string, readonly DerivedCollectionDefinition[]>()
  const root = direct.get('Entity') ?? []
  validateEffectiveNavigations('Entity', fields.get('Entity') ?? new Set(), root)
  result.set('Entity', root)
  for (const entity of entities) {
    const chain: EntityDefinition[] = []
    let current: string | undefined = entity.name
    while (current !== undefined && current !== 'Entity') {
      const definition = byName.get(current)
      if (!definition) break
      chain.unshift(definition)
      current = definition.parent
    }
    const navigations = [
      ...root,
      ...chain.flatMap(definition => direct.get(definition.name) ?? []),
    ]
    validateEffectiveNavigations(
      entity.name,
      fields.get(entity.name) ?? new Set(),
      navigations,
    )
    result.set(entity.name, navigations)
  }
  return result
}

/**
 * Validate effective navigations against fields and each other.
 * @param entityName - Exposing entity name.
 * @param fields - Effective field names.
 * @param navigations - Inherited and local navigations.
 */
function validateEffectiveNavigations(
  entityName: string,
  fields: ReadonlySet<string>,
  navigations: readonly DerivedCollectionDefinition[],
): void {
  const names = new Set<string>()
  for (const navigation of navigations) {
    if (fields.has(navigation.name)) {
      throw invalid(
        `derived navigation "${entityName}.${navigation.name}" ` +
        'conflicts with an inherited navigation or field',
      )
    }
    if (names.has(navigation.name)) {
      throw invalid(`duplicate derived navigation "${entityName}.${navigation.name}"`)
    }
    names.add(navigation.name)
  }
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
  validatePhysicalIdentifier(value.name, 'entity table')
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
  validatePhysicalIdentifier(value.field, `field "${entityName}.${value.field}"`)
  if (typeof value.type !== 'string' && value.field !== 'id') {
    throw invalid(`field "${entityName}.${value.field}" type must be a string`)
  }

  if (value.type === FieldType.Array) {
    return { field: parseArrayField(entityName, value) }
  }

  if (value.type === FieldType.JSON) {
    return { field: parseJSONField(entityName, value) }
  }

  if (value.type === FieldType.Entity) {
    assertKnownKeys(value, ['field', 'inverse', 'target', 'type'], 'field')
    if (ROOT_FIELD_NAMES.has(value.field) || value.field === 'id') {
      throw invalid(`field "${entityName}.${value.field}" is reserved for the universal identity root`)
    }
    if (typeof value.target !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.target)) {
      throw invalid(`reference field "${entityName}.${value.field}" target must be a PascalCase entity name`)
    }
    if (
      value.inverse !== undefined
      && (typeof value.inverse !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(value.inverse))
    ) {
      throw invalid(`reference field "${entityName}.${value.field}" inverse must be a camelCase identifier`)
    }
    validatePhysicalIdentifier(`${value.field}.id`, `reference field "${entityName}.${value.field}" column`)
    return {
      field: {
        column: `${value.field}.id`,
        ...(value.inverse !== undefined ? { inverse: value.inverse as string } : {}),
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
 * Validate one opaque JSON field descriptor.
 * @param entityName - Owning entity name.
 * @param value - Field candidate.
 * @returns The validated JSON field.
 */
function parseJSONField(
  entityName: string,
  value: Readonly<Record<string, unknown>>,
): JSONFieldDefinition {
  assertKnownKeys(value, ['field', 'type'], 'field')
  const name = value.field as string
  if (name === 'id' || ROOT_FIELD_NAMES.has(name)) {
    throw invalid(`field "${entityName}.${name}" is reserved for the universal identity root`)
  }
  return { name, type: FieldType.JSON }
}

/**
 * Validate one native scalar-array field descriptor.
 * @param entityName - Owning entity name.
 * @param value - Field candidate.
 * @returns The validated array field.
 */
function parseArrayField(
  entityName: string,
  value: Readonly<Record<string, unknown>>,
): ArrayFieldDefinition {
  assertKnownKeys(value, ['field', 'items', 'type'], 'field')
  const name = value.field as string
  if (name === 'id' || ROOT_FIELD_NAMES.has(name)) {
    throw invalid(`field "${entityName}.${name}" is reserved for the universal identity root`)
  }
  if (!isRecord(value.items)) {
    throw invalid(`array field "${entityName}.${name}" items must be an object`)
  }
  const items = value.items
  if (typeof items.type !== 'string' || !SCALAR_FIELD_TYPES.has(items.type)) {
    throw invalid(`array field "${entityName}.${name}" items must be a scalar type`)
  }
  if (items.type === FieldType.ID) {
    assertKnownKeys(items, ['format', 'type'], 'array item')
    if (items.format !== undefined && (typeof items.format !== 'string' || !IDENTITY_FORMATS.has(items.format))) {
      throw invalid(`array field "${entityName}.${name}" ID format must be UUID or Snowflake`)
    }
    return {
      items: {
        ...(items.format !== undefined ? { format: items.format as IdentityFormat } : {}),
        type: FieldType.ID,
      },
      name,
      type: FieldType.Array,
    }
  }
  assertKnownKeys(items, ['type'], 'array item')
  return { items: { type: items.type as ScalarFieldType }, name, type: FieldType.Array }
}

/**
 * Validate generated PostgreSQL identifier length.
 * @param value - Generated identifier.
 * @param context - Diagnostic label.
 */
function validatePhysicalIdentifier(value: string, context: string): void {
  if (new TextEncoder().encode(value).length > 63) {
    throw invalid(`${context} "${value}" exceeds PostgreSQL's 63-byte identifier limit`)
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
    collections: [],
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
 * @param indexes - Additional indexes derived from inverse references.
 * @returns Its physical table metadata.
 */
function entityTable(
  entity: EntityDefinition,
  indexes: readonly TableIndex[] = [],
): TableDefinition {
  return {
    checks: [{
      expression: identityCheck('id', entity.idFormat),
      name: `${entity.name}_id_format_check`,
    }],
    columns: entity.fields.map(fieldTableColumn),
    ...(indexes.length > 0 ? { indexes } : {}),
    name: entity.name,
  }
}

/**
 * Build one physical table column from a scalar, array, JSON or reference field.
 * @param field - Logical field.
 * @returns Physical column metadata.
 */
function fieldTableColumn(field: FieldDefinition): TableColumn {
  if (field.type === FieldType.Entity) {
    return { name: field.column, nullable: true, type: FieldType.String }
  }
  if (field.type === FieldType.ID) return { name: field.name, primaryKey: true, type: FieldType.ID }
  if (field.type === FieldType.Array) {
    return { arrayType: field.items.type, name: field.name, type: FieldType.Array }
  }
  return { name: field.name, type: field.type }
}

/**
 * Derive indexes for physical forward FKs used by inverse navigations.
 * @param entities - Resolved canonical definitions.
 * @returns Deduplicated indexes by owning entity table.
 */
function inverseReferenceIndexes(
  entities: readonly EntityDefinition[],
): ReadonlyMap<string, readonly TableIndex[]> {
  const result = new Map<string, TableIndex[]>()
  const seen = new Set<string>()
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (field.type !== FieldType.Entity || field.inverse === undefined) continue
      const key = `${entity.name}\u0000${field.column}`
      if (seen.has(key)) continue
      seen.add(key)
      const indexes = result.get(entity.name) ?? []
      indexes.push({
        columns: [field.column],
        name: `${entity.name}_${field.name}_fk_idx`,
      })
      result.set(entity.name, indexes)
    }
  }
  return result
}

/** One foreign-key definition for a relationship table. */
interface RelationshipForeignKeyDefinition {
  /** Local column. */
  readonly column: string,
  /** Deterministic constraint name. */
  readonly name: string,
  /** CREATE ALTER statement. */
  readonly statement: string,
  /** Referenced entity table. */
  readonly target: string,
}

/**
 * Build one physical relationship table.
 * @param relationship - Named relationship definition.
 * @returns Its table metadata.
 */
function relationshipTable(relationship: RelationshipDefinition): TableDefinition {
  const endpointColumns = relationship.between.map(endpoint => ({
    name: `${endpoint.field}.id`,
    type: FieldType.String,
  })) satisfies TableColumn[]
  return {
    columns: [...endpointColumns, ...relationship.fields.map(fieldTableColumn)],
    indexes: relationship.between.map(endpoint => ({
      columns: [`${endpoint.field}.id`],
      name: `${relationship.name}_${endpoint.field}_idx`,
    })),
    name: relationship.name,
    primaryKey: endpointColumns.map(column => column.name),
  }
}

/**
 * Build the foreign-key statements for one relationship table.
 * @param relationship - Named relationship definition.
 * @returns Endpoint foreign-key statements in authored order.
 */
function relationshipConstraints(relationship: RelationshipDefinition): readonly string[] {
  return relationshipForeignKeyDefinitions(relationship).map(definition => definition.statement)
}

/**
 * Build foreign-key metadata for one relationship table.
 * @param relationship - Named relationship definition.
 * @returns Endpoint foreign-key definitions in authored order.
 */
function relationshipForeignKeyDefinitions(
  relationship: RelationshipDefinition,
): readonly RelationshipForeignKeyDefinition[] {
  return relationship.between.map(endpoint => (
    relationshipForeignKey(relationship, endpoint)
  ))
}

/**
 * Build one relationship endpoint foreign-key definition.
 * @param relationship - Named relationship definition.
 * @param endpoint - Authored endpoint descriptor.
 * @returns Foreign-key metadata.
 */
function relationshipForeignKey(
  relationship: RelationshipDefinition,
  endpoint: RelationshipEndpointDefinition,
): RelationshipForeignKeyDefinition {
  const column = `${endpoint.field}.id`
  const name = `${relationship.name}_${endpoint.field}_fkey`
  return {
    column,
    name,
    statement: `alter table ${quoteIdentifier(relationship.name)} ` +
      `add constraint ${quoteIdentifier(name)} ` +
      `foreign key (${quoteIdentifier(column)}) ` +
      `references ${quoteIdentifier(endpoint.target)} ("id") deferrable initially immediate`,
    target: endpoint.target,
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
    const nullability = column.primaryKey ? ' primary key' : column.nullable ? '' : ' not null'
    return `${quoteIdentifier(column.name)} ${columnType(column)}${nullability}`
  })
  const checks = (table.checks ?? []).map(check => (
    `constraint ${quoteIdentifier(check.name)} check (${check.expression})`
  ))
  const primaryKey = table.primaryKey
    ? [`primary key (${table.primaryKey.map(quoteIdentifier).join(', ')})`]
    : []
  return `create table ${quoteIdentifier(table.name)} (\n${[...columns, ...primaryKey, ...checks].join(',\n')}\n)`
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
 * Resolve the physical PostgreSQL type for a table column.
 * @param column - Physical column metadata.
 * @returns Column type declaration.
 */
function columnType(column: TableColumn): string {
  if (column.type === FieldType.Array) {
    if (!column.arrayType) throw new Error(`Array column "${column.name}" has no element type`)
    return `${scalarColumnType(column.arrayType)}[]`
  }
  if (column.type === FieldType.JSON) return 'jsonb'
  return scalarColumnType(column.type)
}

/**
 * Resolve the physical PostgreSQL type for a scalar field.
 * @param type - Scalar field type.
 * @returns Column type declaration.
 */
function scalarColumnType(type: ScalarFieldType): string {
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
