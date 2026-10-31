import { match } from '../../utilities'
import type { EntityDefinition, EntityDefinitions, FieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { Predicate } from './Predicate'
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
  /** Selected root field definitions, in output order. */
  readonly fields: readonly FieldDefinition[],
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

  const definitions = new Map(entity.fields.map(field => [field.name, field]))
  const selected = fields.map(field => {
    const selectedField = definitions.get(field)
    if (!selectedField) throw new Error(`Unknown field "${entityName}.${field}"`)
    return selectedField
  })

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
  readonly validateOperand: (field: FieldDefinition, raw: unknown) => BoundScalar | null,
}

/** A per-logical-operator definition used by the closed operator registry. */
interface LogicalDefinition {
  /** Build a parenthesized logical group. */
  readonly build: (children: readonly string[]) => string,
  /** Minimum number of child predicates. */
  readonly minimumOperands: number,
}

/** Signed 64-bit Snowflake bounds. */
const SNOWFLAKE_MIN = -9223372036854775808n
const SNOWFLAKE_MAX = 9223372036854775807n

/** All scalar field types support equality. */
const ALL_FIELD_TYPES = new Set<FieldType>(Object.values(FieldType))
/** Only ordered scalar field types support range comparisons. */
const RANGE_FIELD_TYPES = new Set<FieldType>([
  FieldType.Date,
  FieldType.Number,
  FieldType.Snowflake,
  FieldType.String,
  FieldType.Timestamp,
])

/** The complete comparison operator registry. */
const comparisonDefinitions = new Map<Operator.Comparison, ComparisonDefinition>([
  [Operator.Comparison.Equal, {
    allowedFieldTypes: ALL_FIELD_TYPES,
    build: (column, operand, bind) => (operand === null
      ? `${column} IS NULL`
      : `${column} = ${bind(operand)}`),
    validateOperand: scalarValidator(true),
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
])

/**
 * Build parameterized root-field comparison predicates.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param where - Equality shorthand, structured comparisons, or logical groups.
 * @returns The quoted `WHERE` clause and its parameter values.
 * @throws {Error} When the entity, field, operator, or value is invalid.
 */
function whereClause(
  entities: EntityDefinitions,
  entityName: string,
  where: Filter | Readonly<Record<string, unknown>> = {},
): SQLPredicate {
  const entity = definition(entities, entityName)
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
      const field = entity.fields.find(candidate => candidate.name === comparisonFilter.field)
      if (!field) throw new Error(`Unknown field "${entity.name}.${comparisonFilter.field}"`)
      if (!comparison.allowedFieldTypes.has(field.type)) {
        throw new Error(
          `Query operator "${comparisonFilter.operator}" is not valid for field "${entity.name}.${field.name}"`,
        )
      }
      const operand = comparison.validateOperand(field, comparisonFilter.value)
      return comparison.build(quoteIdentifier(field.name), operand, bind)
    }

    const logical = logicalDefinitions.get(node.operator as Operator.Logical)
    if (!logical) throw new Error(`Query operator "${node.operator}" is not supported`)
    const logicalFilter = node as LogicalFilter
    if (logicalFilter.filters.length < logical.minimumOperands) {
      throw new Error(
        `Query operator "${logicalFilter.operator}" requires at least ${logical.minimumOperands} operand(s)`,
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
      return `${column} ${operator} ${bind(operand)}`
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

    return match(field.type)
      .when(FieldType.Boolean).then(() => (
        typeof raw === 'boolean' ? raw : invalidOperand(field)
      ))
      .when(FieldType.Date).then(() => (
        typeof raw === 'string' && raw.length > 0 ? raw : invalidOperand(field)
      ))
      .when(FieldType.Number).then(() => (
        typeof raw === 'number' && Number.isFinite(raw) ? raw : invalidOperand(field)
      ))
      .when(FieldType.Snowflake).then(() => {
        if (typeof raw === 'bigint') return raw
        if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
          const value = BigInt(raw)
          if (value >= SNOWFLAKE_MIN && value <= SNOWFLAKE_MAX) return raw
        }
        return invalidOperand(field)
      })
      .when(FieldType.String).then(() => (
        typeof raw === 'string' ? raw : invalidOperand(field)
      ))
      .when(FieldType.Timestamp).then(() => {
        if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
        if (typeof raw === 'string' && raw.length > 0) return raw
        return invalidOperand(field)
      })
      .when(FieldType.UUID).then(() => (
        typeof raw === 'string' && raw.length > 0 ? raw : invalidOperand(field)
      ))
      .else(() => invalidOperand(field))
  }
}

/**
 * Throw the standard operand error.
 * @param field - Field whose operand is invalid.
 * @throws {Error} Always, naming the invalid operand.
 */
function invalidOperand(field: FieldDefinition): never {
  throw new Error(`Query operand for "${field.name}" is not a valid ${field.type} value`)
}

/**
 * Build a validated root-field ordering clause.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param orderBy - Root field and direction, when ordering is requested.
 * @returns The quoted `ORDER BY` clause.
 * @throws {Error} When the entity, field, or direction is invalid.
 */
function orderByClause(
  entities: EntityDefinitions,
  entityName: string,
  orderBy?: OrderBy,
): SQLOrder {
  if (orderBy === undefined) return { sql: '' }

  const entity = definition(entities, entityName)
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy]
  if (entries.length === 0) return { sql: '' }

  const clauses = entries.map(entry => {
    const field = typeof entry === 'string' ? entry : entry.field
    const direction = typeof entry === 'string' ? SortDirection.Ascending : entry.direction ?? SortDirection.Ascending

    if (!entity.fields.some(candidate => candidate.name === field)) {
      throw new Error(`Unknown field "${entityName}.${field}"`)
    }
    if (direction !== SortDirection.Ascending && direction !== SortDirection.Descending) {
      throw new Error('Query orderBy direction must be "asc" or "desc"')
    }

    return `${quoteIdentifier(field)} ${direction.toUpperCase()}`
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
