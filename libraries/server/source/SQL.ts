import type { EntityDefinition, EntityDefinitions, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { Predicate } from './Predicate'
import { normalizeScalar } from './ScalarNormalization'
import { SortDirection } from './SortDirection'

/** A validated ordering clause. */
export interface SQLOrder {
  /** Quoted `ORDER BY` clause, or an empty string. */
  readonly sql: string,
}

/** A validated parameterized pagination clause. */
export interface SQLPagination {
  /** Quoted `LIMIT`/`OFFSET` clause, or an empty string. */
  readonly sql: string,
  /** Values for the `$1`, `$2`, … placeholders. */
  readonly values: readonly unknown[],
}

/** A root-field sort request. */
export interface OrderByField {
  /** Sort direction; defaults to ascending. */
  readonly direction?: SortDirection,
  /** Root field to sort by. */
  readonly field: string,
}

/** A single or multi-level root-field ordering expression. */
export type OrderBy =
  | string
  | OrderByField
  | readonly (string | OrderByField)[]

/** A validated root projection. */
export interface SQLSelection {
  /** Selected root scalar field definitions, in output order. */
  readonly fields: readonly ScalarFieldDefinition[],
  /** Quoted PostgreSQL `SELECT` clause. */
  readonly sql: string,
}

/** A validated parameterized predicate clause. */
export interface SQLPredicate {
  /** Quoted PostgreSQL `WHERE` clause, or an empty string. */
  readonly sql: string,
  /** Values for the `$1`, `$2`, … placeholders. */
  readonly values: readonly unknown[],
}

/** Optional effective-field scope for polymorphic entity queries. */
export interface QueryScope {
  /** Effective entity metadata used for validation. */
  readonly definition: EntityDefinition,
  /** Render a field expression with physical table qualification. */
  readonly expression: (field: ScalarFieldDefinition) => string,
  /** Resolve a logical field by name. */
  readonly field: (name: string) => ScalarFieldDefinition,
}

/**
 * Build a root-field projection for one entity.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param fields - Root scalar fields to project, in output order.
 * @returns The selected definitions and quoted `SELECT` clause.
 * @throws {Error} When the entity or a selected field is unknown.
 */
function select(
  entities: EntityDefinitions,
  entityName: string,
  fields: readonly string[],
): SQLSelection {
  const entity = definition(entities, entityName)
  if (fields.length === 0) throw new Error('Query fields must be a non-empty array')

  const selected = fields.map(field => scalarField(entity, field))
  const projection = selected.map(field => quoteIdentifier(field.name)).join(', ')
  return { fields: selected, sql: `SELECT ${projection} FROM ${quoteIdentifier(entity.name)}` }
}

/** A validated scalar value bound into a query. */
type BoundScalar = string | number | boolean | bigint | Date

/** A per-comparison definition used by the closed operator registry. */
interface ComparisonDefinition {
  /** Field types the operator supports. */
  readonly allowedFieldTypes: ReadonlySet<FieldType>,
  /** Build the SQL fragment and bind its value. */
  readonly build: (
    column: string,
    operand: BoundScalar | null,
    bind: (value: BoundScalar) => string,
  ) => string,
  /** Validate and normalize the raw operand. */
  readonly validateOperand: (field: ScalarFieldDefinition, raw: unknown) => BoundScalar | null,
}

/** A per-logical-operator definition used by the closed operator registry. */
interface LogicalDefinition {
  /** Build a parenthesized logical group. */
  readonly build: (children: readonly string[]) => string,
  /** Maximum number of child predicates, when fixed. */
  readonly maximumOperands?: number,
  /** Minimum number of child predicates. */
  readonly minimumOperands: number,
}

/** All scalar field types support equality. */
const ALL_FIELD_TYPES = new Set<FieldType>([
  FieldType.Boolean,
  FieldType.Date,
  FieldType.ID,
  FieldType.Number,
  FieldType.String,
  FieldType.Timestamp,
])
/** Only ordered scalar field types support range comparisons. */
const RANGE_FIELD_TYPES = new Set<FieldType>([
  FieldType.Date,
  FieldType.ID,
  FieldType.Number,
  FieldType.String,
  FieldType.Timestamp,
])

/** The complete comparison operator registry. */
const comparisonDefinitions = new Map<Operator.Comparison, ComparisonDefinition>([
  [Operator.Comparison.Equal, {
    allowedFieldTypes: ALL_FIELD_TYPES,
    build: (column, operand, bind) => (operand === null
      ? `${column} IS NULL`
      : `${column} IS NOT DISTINCT FROM ${bind(operand)}`),
    validateOperand: scalarValidator(true),
  }],
  [Operator.Comparison.Contains, {
    allowedFieldTypes: new Set([FieldType.String]),
    build: (column, operand, bind) => {
      if (operand === null) throw new Error('Query operator "$contains" requires a non-null value')
      if (typeof operand !== 'string') throw new Error('Query operator "$contains" requires a string value')
      const pattern = `%${operand.replace(/[\\%_]/gu, '\\$&')}%`
      return `(${column} IS NOT NULL AND ${column} ILIKE ${bind(pattern)} ESCAPE '\\')`
    },
    validateOperand: scalarValidator(false),
  }],
  [Operator.Comparison.GreaterThan, rangeDefinition('>', RANGE_FIELD_TYPES)],
  [Operator.Comparison.GreaterThanOrEqual, rangeDefinition('>=', RANGE_FIELD_TYPES)],
  [Operator.Comparison.LessThan, rangeDefinition('<', RANGE_FIELD_TYPES)],
  [Operator.Comparison.LessThanOrEqual, rangeDefinition('<=', RANGE_FIELD_TYPES)],
])

/** The complete logical operator registry. */
const logicalDefinitions = new Map<Operator.Logical, LogicalDefinition>([
  [Operator.Logical.And, {
    build: children => `(${children.join(' AND ')})`,
    minimumOperands: 1,
  }],
  [Operator.Logical.Not, {
    build: children => `(NOT (${children[0]}))`,
    maximumOperands: 1,
    minimumOperands: 1,
  }],
  [Operator.Logical.Or, {
    build: children => `(${children.join(' OR ')})`,
    minimumOperands: 1,
  }],
])

/**
 * Build parameterized root-field comparison predicates.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param where - Equality shorthand, structured comparisons, or logical groups.
 * @param scope - Optional effective-field expressions for polymorphic queries.
 * @returns The quoted `WHERE` clause and its parameter values.
 * @throws {Error} When the entity, field, operator, or value is invalid.
 */
function whereClause(
  entities: EntityDefinitions,
  entityName: string,
  where: Filter | Readonly<Record<string, unknown>> = {},
  scope?: QueryScope,
): SQLPredicate {
  const entity = scope?.definition ?? definition(entities, entityName)
  const filter = Predicate.normalize(entity, where)
  if (!filter) return { sql: '', values: [] }

  const values: BoundScalar[] = []
  const bind = (value: BoundScalar): string => {
    values.push(value)
    return `$${values.length}`
  }

  const compile = (node: Filter): string => {
    const comparison = comparisonDefinitions.get(node.operator as Operator.Comparison)
    if (comparison) {
      const comparisonFilter = node as ComparisonFilter
      const field = scope ? scope.field(comparisonFilter.field) : scalarField(entity, comparisonFilter.field)
      if (!comparison.allowedFieldTypes.has(field.type)) {
        throw new Error(
          `Query operator "${comparisonFilter.operator}" is not valid for field "${entity.name}.${field.name}"`,
        )
      }
      const operand = comparison.validateOperand(field, comparisonFilter.value)
      return comparison.build(scope ? scope.expression(field) : quoteIdentifier(field.name), operand, bind)
    }

    const logical = logicalDefinitions.get(node.operator as Operator.Logical)
    if (!logical) throw new Error(`Query operator "${node.operator}" is not supported`)
    const logicalFilter = node as LogicalFilter
    if (logicalFilter.filters.length < logical.minimumOperands) {
      throw new Error(
        `Query operator "${logicalFilter.operator}" requires at least ${logical.minimumOperands} operand(s)`,
      )
    }
    if (logical.maximumOperands !== undefined && logicalFilter.filters.length > logical.maximumOperands) {
      throw new Error(
        `Query operator "${logicalFilter.operator}" requires at most ${logical.maximumOperands} operand(s)`,
      )
    }
    return logical.build(logicalFilter.filters.map(compile))
  }

  return { sql: `WHERE ${compile(filter)}`, values }
}

/**
 * Create a parameterized range-comparison definition.
 * @param operator - SQL comparison operator.
 * @param allowedFieldTypes - Field types that support ordered comparison.
 * @returns The comparison definition.
 */
function rangeDefinition(
  operator: string,
  allowedFieldTypes: ReadonlySet<FieldType>,
): ComparisonDefinition {
  return {
    allowedFieldTypes,
    build: (column, operand, bind) => {
      if (operand === null) throw new Error(`Query operator "${operator}" requires a non-null value`)
      return `COALESCE(${column} ${operator} ${bind(operand)}, FALSE)`
    },
    validateOperand: scalarValidator(false),
  }
}

/**
 * Create the shared scalar operand validator.
 * @param allowNull - Whether null equality is valid.
 * @returns The validator.
 */
function scalarValidator(allowNull: boolean): ComparisonDefinition['validateOperand'] {
  return (field, raw) => {
    if (raw === undefined) throw new Error(`Query operand for "${field.name}" must not be undefined`)
    if (raw === null) {
      if (allowNull) return null
      throw new Error(`Query operand for "${field.name}" must not be null`)
    }

    const normalized = normalizeScalar(field, raw)
    if (normalized === undefined) invalidOperand(field)
    return normalized
  }
}

/**
 * Throw the standard operand error.
 * @param field - Field whose operand is invalid.
 * @throws {Error} Always, naming the invalid operand.
 */
function invalidOperand(field: ScalarFieldDefinition): never {
  throw new Error(`Query operand for "${field.name}" is not a valid ${field.type.toLowerCase()} value`)
}

/**
 * Build a validated root-field ordering clause.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param orderBy - Root field and direction, when ordering is requested.
 * @param scope - Optional effective-field expressions for polymorphic queries.
 * @returns The quoted `ORDER BY` clause.
 * @throws {Error} When the entity, field, or direction is invalid.
 */
function orderByClause(
  entities: EntityDefinitions,
  entityName: string,
  orderBy?: OrderBy,
  scope?: QueryScope,
): SQLOrder {
  if (orderBy === undefined) return { sql: '' }

  const entity = scope?.definition ?? definition(entities, entityName)
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy]
  if (entries.length === 0) return { sql: '' }

  const clauses = entries.map(entry => {
    const name = typeof entry === 'string' ? entry : entry.field
    const direction = typeof entry === 'string' ? SortDirection.Ascending : entry.direction ?? SortDirection.Ascending
    const field = scope ? scope.field(name) : scalarField(entity, name)

    if (direction !== SortDirection.Ascending && direction !== SortDirection.Descending) {
      throw new Error('Query orderBy direction must be "asc" or "desc"')
    }

    return `${scope ? scope.expression(field) : quoteIdentifier(field.name)} ${direction.toUpperCase()}`
  })

  return { sql: `ORDER BY ${clauses.join(', ')}` }
}

/**
 * Build a validated parameterized pagination clause.
 * @param limit - Maximum rows to return, or null for unlimited.
 * @param offset - Rows to skip.
 * @param startIndex - Number of prior parameter values.
 * @returns The quoted pagination clause and its parameter values.
 * @throws {Error} When limit or offset is not a non-negative integer.
 */
function paginate(
  limit: number | null = 25,
  offset = 0,
  startIndex = 0,
): SQLPagination {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('Query limit must be a non-negative integer or null')
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('Query offset must be a non-negative integer')
  }

  const clauses: string[] = []
  const values: unknown[] = []
  if (limit !== null) {
    values.push(limit)
    clauses.push(`LIMIT $${startIndex + values.length}`)
  }
  if (limit !== null || offset > 0) {
    values.push(offset)
    clauses.push(`OFFSET $${startIndex + values.length}`)
  }

  return { sql: clauses.join(' '), values }
}

/**
 * Internal construction of model-aware SQL. Bun owns execution; this owner
 * builds only projection, predicate, ordering, and pagination syntax from
 * validated entity metadata.
 */
export const SQL = { orderBy: orderByClause, paginate, select, where: whereClause }

/**
 * Require a selectable scalar field from an entity.
 * @param entity - Entity whose fields are referenced.
 * @param name - Logical field name.
 * @returns The scalar field definition.
 * @throws {Error} When the field is unknown or is an entity reference.
 */
function scalarField(entity: EntityDefinition, name: string): ScalarFieldDefinition {
  const field = entity.fields.find(candidate => candidate.name === name)
  if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)
  if (field.type === FieldType.Entity) {
    throw new Error(
      `Query field "${entity.name}.${name}" is an entity reference; ` +
      'references cannot be used in predicates or ordering',
    )
  }
  if (field.type === FieldType.Collection) {
    throw new Error(
      `Query field "${entity.name}.${name}" is a collection; ` +
      'collection projections are not supported yet',
    )
  }
  return field
}

/**
 * Require an entity from validated definitions.
 * @param entities - Validated entity definitions.
 * @param name - Exact entity name.
 * @returns The entity definition.
 * @throws {Error} When the entity is unknown.
 */
function definition(entities: EntityDefinitions, name: string): EntityDefinition {
  const entity = entities.entity(name)
  if (!entity) throw new Error(`Unknown entity "${name}"`)
  return entity
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Entity or field name.
 * @returns The quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}
