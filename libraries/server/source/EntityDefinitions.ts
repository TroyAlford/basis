import type { SQL } from 'bun'

/** Enable PostgreSQL trigram search for universal display names. */
const IDENTITY_EXTENSION_DDL = 'create extension if not exists pg_trgm with schema public'

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
   * Externally assigned signed 64-bit identity format. Values are canonical
   * decimal strings; exact bigint inputs normalize to canonical text.
   */
  Snowflake = 'snowflake',
  /** Text value. */
  String = 'string',
  /** Instant in time. */
  Timestamp = 'timestamp',
  /** Canonical lowercase UUID identity format. */
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

/** A primary-key scalar whose logical type is a supported identity format. */
type IdentityField = ScalarFieldDefinition & {
  /** UUID or Snowflake identity format. */
  readonly type: FieldType.Snowflake | FieldType.UUID,
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
  /** Whether this entity is abstract and cannot be a concrete leaf. */
  readonly abstract: boolean,
  /** Logical fields in their declared order. */
  readonly fields: readonly FieldDefinition[],
  /** Entity name, in PascalCase. */
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

/** One table-level check constraint. */
interface TableCheck {
  /** SQL boolean expression. */
  readonly expression: string,
  /** Constraint name. */
  readonly name: string,
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

/**
 * Build the system-owned universal identity root.
 *
 * This is internal physical metadata, not a user-declarable entity. Public
 * primary-key validation still accepts only UUID and Snowflake fields.
 * @param entities - Validated entity definitions.
 * @returns The physical identity-root table.
 */
function identityRoot(entities: readonly EntityDefinition[]): TableDefinition {
  const leaves = entities.filter(entity => !entity.abstract).map(entity => quoteLiteral(entity.name))
  const leafCheck = leaves.length === 0 ? 'false' : `"entity" in (${leaves.join(', ')})`
  return {
    checks: [
      {
        expression: `(${identityCheck('id', FieldType.UUID)} or ${identityCheck('id', FieldType.Snowflake)})`,
        name: 'Entity_id_format_check',
      },
      {
        expression: leafCheck,
        name: 'Entity_entity_check',
      },
    ],
    columns: [
      { name: 'id', primaryKey: true, type: FieldType.String },
      { name: 'displayName', type: FieldType.String },
      { name: 'entity', type: FieldType.String },
    ],
    indexes: [
      { columns: ['displayName', 'id'], name: 'Entity_displayName_id_idx' },
      {
        columns: ['displayName'],
        method: 'gin',
        name: 'Entity_displayName_trgm_idx',
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
   * foreign-key constraints are added afterward with `alter table`. This
   * supports cyclic and self-referential references without ordering cycles.
   * Identifiers are quoted; user values never enter these statements.
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
   * Create missing physical tables, including the system-owned identity root,
   * then add missing foreign-key constraints.
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
    await sql.unsafe(IDENTITY_EXTENSION_DDL).simple()
    for (const table of this.tables) {
      const rows = await sql<{ present: boolean }[]>`
        select exists (
          select 1
          from pg_catalog.pg_tables
          where schemaname = current_schema()
            and tablename = ${table.name}
        ) as present
      `
      const created = !rows[0]?.present
      if (created) await sql.unsafe(createTable(table)).simple()
      for (const index of table.indexes ?? []) {
        if (!created && await indexExists(sql, index.name)) continue
        await sql.unsafe(createIndex(table, index)).simple()
      }
    }

    for (const entity of this.entities) {
      const localKey = primaryKeyField(entity).name
      const targetKey = parentKey(entity)
      await reconcileForeignKey(
        sql,
        entity.name,
        parentConstraintName(entity),
        localKey,
        entity.parent,
        targetKey,
        addParentConstraint(entity),
      )
      for (const field of entity.fields.filter(isReferenceField)) {
        await reconcileForeignKey(
          sql,
          entity.name,
          constraintName(entity, field),
          field.column,
          field.target,
          field.targetField,
          addConstraint(entity, field),
        )
      }
    }

    for (const statement of lifecycleStatements(this.entities)) {
      await sql.unsafe(statement).simple()
    }
  }
}

/**
 * Build commit-time triggers that keep MTI root/leaf chains complete.
 * @param entities - Validated entity definitions.
 * @returns Function and trigger DDL in dependency order.
 */
function lifecycleStatements(entities: readonly EntityDefinition[]): readonly string[] {
  const concrete = entities.filter(entity => !entity.abstract)
  const leafChecks = concrete.map(entity => {
    const key = quoteIdentifier(primaryKeyField(entity).name)
    return `when ${quoteLiteral(entity.name)} then
        if not exists (select 1 from ${quoteIdentifier(entity.name)} where ${key} = new."id") then
          raise exception 'incomplete root row % for entity %', new."id", new."entity";
        end if;`
  })
  const validateRoot = `create or replace function "Entity_validate_leaf"() returns trigger language plpgsql as $$
begin
  case new."entity"
    ${leafChecks.join('\n    ')}
    else
      raise exception 'unknown concrete entity %', new."entity";
  end case;
  return new;
end
$$`
  const validateLeafRow =
    'create or replace function "Entity_validate_leaf_row"() ' +
    `returns trigger language plpgsql as $$
declare
  key text;
  root_entity text;
begin
  if tg_op = 'DELETE' then
    key := to_jsonb(old)->>tg_argv[0];
    if exists (select 1 from "Entity" where "id" = key) then
      raise exception 'deleting leaf row % would leave an incomplete root row', key;
    end if;
    return old;
  end if;
  key := to_jsonb(new)->>tg_argv[0];
  select "entity" into root_entity from "Entity" where "id" = key;
  if root_entity is distinct from tg_table_name then
    raise exception 'leaf row % must match root entity %, found %',
      key, tg_table_name, coalesce(root_entity, '<missing>');
  end if;
  return new;
end
$$`
  const immutableLeaf = `create or replace function "Entity_leaf_immutable"() returns trigger language plpgsql as $$
begin
  if new."entity" is distinct from old."entity" then
    raise exception 'leaf discriminator for root row % is immutable', old."id";
  end if;
  return new;
end
$$`
  const rootTrigger = 'Entity_leaf_check'
  const immutableTrigger = 'Entity_leaf_immutable'
  return [
    validateRoot,
    `drop trigger if exists ${quoteIdentifier(rootTrigger)} on "Entity"`,
    `create constraint trigger ${quoteIdentifier(rootTrigger)} ` +
    'after insert or update on "Entity" deferrable initially deferred ' +
    'for each row execute function "Entity_validate_leaf"()',
    validateLeafRow,
    ...concrete.flatMap(entity => {
      const name = `${entity.name}_leaf_check`
      return [
        `drop trigger if exists ${quoteIdentifier(name)} on ${quoteIdentifier(entity.name)}`,
        `create constraint trigger ${quoteIdentifier(name)} ` +
        `after insert or update or delete on ${quoteIdentifier(entity.name)} ` +
        'deferrable initially deferred for each row execute function "Entity_validate_leaf_row"' +
        `(${quoteLiteral(primaryKeyField(entity).name)})`,
      ]
    }),
    immutableLeaf,
    `drop trigger if exists ${quoteIdentifier(immutableTrigger)} on "Entity"`,
    `create trigger ${quoteIdentifier(immutableTrigger)} ` +
    'before update of "entity" on "Entity" for each row ' +
    'execute function "Entity_leaf_immutable"()',
  ]
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
  validateAncestry(seeds, byName)
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
  /** Whether this entity is abstract. */
  readonly abstract: boolean,
  /** Optional declared parent entity name. */
  readonly ancestor?: string,
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
  assertKnownKeys(value, ['abstract', 'extends', 'fields', 'name'], 'entity')

  if (typeof value.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.name)) {
    throw invalid('entity name must be a PascalCase identifier')
  }
  if (value.name === 'Entity') {
    throw invalid('entity name "Entity" is reserved for the universal identity root')
  }
  if (value.abstract !== undefined && typeof value.abstract !== 'boolean') {
    throw invalid(`entity "${value.name}" abstract must be a boolean`)
  }
  if (
    value.extends !== undefined
    && (typeof value.extends !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(value.extends))
  ) {
    throw invalid(`entity "${value.name}" extends must be a PascalCase entity name`)
  }

  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    throw invalid(`entity "${value.name}" must define a non-empty fields array`)
  }

  const names = new Set<string>()
  const fields = value.fields.map(field => parseField(value.name as string, field))
  for (const field of fields) {
    if (names.has(field.name)) throw invalid(`duplicate field "${value.name}.${field.name}"`)
    names.add(field.name)
    if (ROOT_FIELD_NAMES.has(field.name)) {
      throw invalid(`field "${value.name}.${field.name}" is reserved for the universal identity root`)
    }
    const column = fieldColumn(field)
    if (ROOT_FIELD_NAMES.has(column)) {
      throw invalid(`physical column "${column}" is reserved for the universal identity root`)
    }
  }

  const primaryKeys = fields.filter(isScalarField).filter(field => field.primaryKey)
  if (primaryKeys.length !== 1) {
    throw invalid(`entity "${value.name}" must define exactly one primary key`)
  }
  const primaryKey = primaryKeys[0] as ParsedScalarField
  if (primaryKey.type !== FieldType.UUID && primaryKey.type !== FieldType.Snowflake) {
    throw invalid(`primary key "${value.name}.${primaryKey.name}" must be type uuid or snowflake`)
  }

  return {
    abstract: value.abstract === true,
    ancestor: value.extends as string | undefined,
    fields,
    name: value.name,
    primaryKey,
  }
}

/**
 * Validate MTI parents, cycles and single ownership of inherited fields.
 * @param seeds - Parsed entity seeds.
 * @param byName - All parsed entities by name.
 * @throws {Error} When ancestry or inherited field ownership is invalid.
 */
function validateAncestry(
  seeds: readonly EntitySeed[],
  byName: ReadonlyMap<string, EntitySeed>,
): void {
  for (const seed of seeds) {
    const parentName = seed.ancestor ?? 'Entity'
    if (parentName === 'Entity') continue
    const parent = byName.get(parentName)
    if (!parent) throw invalid(`unknown parent entity "${parentName}"`)
    if (!parent.abstract) throw invalid(`parent entity "${parentName}" must be abstract`)
    if (seed.primaryKey.name !== parent.primaryKey.name) {
      throw invalid(
        `primary key name must match parent entity "${parentName}": ` +
        `expected "${parent.primaryKey.name}", received "${seed.primaryKey.name}"`,
      )
    }
    if (seed.primaryKey.type !== parent.primaryKey.type) {
      throw invalid(
        `primary key type must match parent entity "${parentName}": ` +
        `expected "${parent.primaryKey.type}", received "${seed.primaryKey.type}"`,
      )
    }
  }

  for (const seed of seeds) {
    const seen = new Set<string>()
    let current: string | undefined = seed.name
    while (current !== undefined && current !== 'Entity') {
      if (seen.has(current)) throw invalid(`ancestry cycle detected at entity "${current}"`)
      seen.add(current)
      current = byName.get(current)?.ancestor
    }
  }

  for (const seed of seeds) {
    const fields = new Map<string, string>()
    const columns = new Map<string, string>()
    let parentName = seed.ancestor
    while (parentName !== undefined && parentName !== 'Entity') {
      const parent = byName.get(parentName)
      if (!parent) break
      for (const field of parent.fields) {
        if (isScalarField(field) && field.primaryKey) continue
        fields.set(field.name, parent.name)
        columns.set(fieldColumn(field), parent.name)
      }
      parentName = parent.ancestor
    }

    for (const field of seed.fields) {
      if (isScalarField(field) && field.primaryKey) continue
      const owner = fields.get(field.name)
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
 * Return the physical column name for one logical field.
 * @param field - Parsed field.
 * @returns Its PostgreSQL column name.
 */
function fieldColumn(field: ParsedField): string {
  return field.type === FieldType.Entity ? field.column : field.name
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
  return {
    abstract: seed.abstract,
    fields,
    name: seed.name,
    parent: seed.ancestor ?? 'Entity',
  }
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
 * Whether a resolved field is a scalar primary key.
 * @param field - Resolved logical field.
 * @returns `true` for the primary-key field.
 */
function isPrimaryKeyField(field: FieldDefinition): field is IdentityField {
  return isScalarField(field) && field.primaryKey
}

/**
 * Whether a resolved field carries a UUID or Snowflake identity format.
 * @param field - Resolved logical field.
 * @returns `true` for identity-formatted scalar fields.
 */
function isIdentityField(field: FieldDefinition): field is IdentityField {
  return isScalarField(field)
    && (field.type === FieldType.UUID || field.type === FieldType.Snowflake)
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
 * Compile one canonical entity into physical table metadata.
 * @param entity - The validated entity.
 * @returns Its physical table definition.
 */
function entityTable(entity: EntityDefinition): TableDefinition {
  return {
    checks: entity.fields.filter(isIdentityField).map(field => ({
      expression: identityCheck(field.name, field.type),
      name: `${entity.name}_${field.name}_format_check`,
    })),
    columns: entity.fields.map(field => {
      if (field.type === FieldType.Entity) {
        return { name: field.column, type: FieldType.String }
      }
      if (field.primaryKey) {
        return { name: field.name, primaryKey: true, type: FieldType.String }
      }
      return { name: field.name, type: field.type }
    }),
    name: entity.name,
  }
}

/**
 * Build a format check for one physical text identity key.
 * @param column - Physical primary-key column.
 * @param type - Logical identity format.
 * @returns A PostgreSQL boolean expression.
 */
function identityCheck(column: string, type: FieldType.UUID | FieldType.Snowflake): string {
  const identifier = quoteIdentifier(column)
  if (type === FieldType.UUID) return `${identifier} ~ '${UUID_IDENTITY_PATTERN}'`
  return `case
    when ${identifier} ~ '${SNOWFLAKE_IDENTITY_PATTERN}' and length(${identifier}) <= 20
      then ${identifier}::numeric between ${SNOWFLAKE_MIN_TEXT} and ${SNOWFLAKE_MAX_TEXT}
    else false
  end`
}

/**
 * Build the statements for one physical table.
 * @param table - Physical table metadata.
 * @returns Its table statement followed by its index statements.
 */
function tableStatements(table: TableDefinition): readonly string[] {
  return [
    createTable(table),
    ...(table.indexes ?? []).map(index => createIndex(table, index)),
  ]
}

/**
 * Build one physical table's idempotent statement.
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
 * Build one physical table's idempotent index statement.
 * @param table - Owning table.
 * @param index - Index metadata.
 * @returns The `create index` statement.
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
 * Build one MTI parent foreign-key constraint statement.
 * @param entity - Owning entity.
 * @returns The `alter table` statement.
 */
function addParentConstraint(entity: EntityDefinition): string {
  const key = primaryKeyField(entity).name
  const targetKey = parentKey(entity)
  return `alter table ${quoteIdentifier(entity.name)} ` +
    `add constraint ${quoteIdentifier(parentConstraintName(entity))} ` +
    `foreign key (${quoteIdentifier(key)}) ` +
    `references ${quoteIdentifier(entity.parent)} (${quoteIdentifier(targetKey)}) ` +
    'deferrable initially immediate'
}

/**
 * Build one foreign-key constraint statement.
 * @param entity - Owning entity.
 * @param field - Resolved entity-reference field.
 * @returns The `alter table` statement.
 */
function addConstraint(entity: EntityDefinition, field: EntityReferenceFieldDefinition): string {
  return `alter table ${quoteIdentifier(entity.name)} ` +
    `add constraint ${quoteIdentifier(constraintName(entity, field))} ` +
    `foreign key (${quoteIdentifier(field.column)}) ` +
    `references ${quoteIdentifier(field.target)} (${quoteIdentifier(field.targetField)}) ` +
    'deferrable initially immediate'
}

/**
 * Reconcile one canonical foreign key against an existing table.
 * @param sql - The connected Bun SQL client.
 * @param entityName - Owning table.
 * @param name - Deterministic constraint name.
 * @param localColumn - Local foreign-key column.
 * @param targetName - Referenced table.
 * @param targetColumn - Referenced column.
 * @param statement - Statement to execute when the constraint is absent.
 * @returns A promise that resolves after the constraint matches or is added.
 * @throws {Error} When an existing constraint does not match the model.
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
    select
      con.condeferrable as deferrable,
      con.condeferred as deferred,
      con.confdeltype as "deleteAction",
      con.confmatchtype as "matchType",
      con.confrelid = ${quoteIdentifier(targetName)}::regclass as "targetMatches",
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
      and con.conrelid = ${quoteIdentifier(entityName)}::regclass
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
 * Find an entity's primary-key field.
 * @param entity - Validated entity.
 * @returns The scalar primary-key field.
 */
function primaryKeyField(entity: EntityDefinition): IdentityField {
  const field = entity.fields.find(isPrimaryKeyField)
  if (!field) throw new Error(`Entity "${entity.name}" has no primary key`)
  return field
}

/**
 * Build one deterministic MTI parent constraint name.
 * @param entity - Owning entity.
 * @returns The constraint name.
 */
function parentConstraintName(entity: EntityDefinition): string {
  return `${entity.name}_${entity.parent}_mti_fkey`
}

/**
 * Resolve the referenced primary-key column for an MTI parent.
 * @param entity - Owning entity.
 * @returns The root `id` or the parent's shared primary-key column.
 */
function parentKey(entity: EntityDefinition): string {
  return entity.parent === 'Entity' ? 'id' : primaryKeyField(entity).name
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
    case FieldType.Boolean: return 'boolean'
    case FieldType.Date: return 'date'
    case FieldType.Number: return 'double precision'
    case FieldType.Snowflake: return 'text'
    case FieldType.String: return 'text'
    case FieldType.Timestamp: return 'timestamptz'
    case FieldType.UUID: return 'text'
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

/**
 * Whether an index exists in the current schema.
 * @param sql - Connected SQL client.
 * @param name - Index name.
 * @returns `true` when present.
 */
async function indexExists(sql: SQL, name: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    select exists (
      select 1 from pg_catalog.pg_indexes
      where schemaname = current_schema() and indexname = ${name}
    ) as present
  `
  return rows[0]?.present === true
}

/**
 * Quote a PostgreSQL string literal. Validated entity names contain no quotes,
 * but escaping at the boundary keeps the DDL safe if the vocabulary expands.
 * @param value - String literal value.
 * @returns The quoted literal.
 */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Canonical UUID text pattern accepted by the universal identity root. */
const UUID_IDENTITY_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
/** Canonical signed 64-bit decimal text pattern. */
const SNOWFLAKE_IDENTITY_PATTERN = '^(0|-?[1-9][0-9]*)$'
/** Canonical signed 64-bit decimal bounds. */
const SNOWFLAKE_MIN_TEXT = '-9223372036854775808'
const SNOWFLAKE_MAX_TEXT = '9223372036854775807'

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

/** Logical and physical names owned by the universal identity root. */
const ROOT_FIELD_NAMES = new Set<string>([
  'displayName',
  'entity',
])

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
