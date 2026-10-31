import type { EntityDefinition, EntityDefinitions, FieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
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

/** A supported comparison operator. */
type ComparisonOperator = '$eq' | '$gt' | '$gte' | '$lt' | '$lte'

/** One normalized root-field comparison. The expression is an implicit AND. */
interface Comparison {
  readonly field: FieldDefinition,
  readonly operator: ComparisonOperator,
  readonly value: unknown,
}

/** Comparison operators that require ordered field types. */
const RANGE_OPERATORS = new Set<ComparisonOperator>(['$gt', '$gte', '$lt', '$lte'])
/** Field types that support range comparisons. */
const RANGE_TYPES = new Set<FieldType>([
  FieldType.Date,
  FieldType.Number,
  FieldType.Snowflake,
  FieldType.String,
  FieldType.Timestamp,
])
/** Every supported comparison operator. */
const COMPARISON_OPERATORS = new Set<string>(['$eq', '$gte', '$gt', '$lte', '$lt'])

/**
 * Build parameterized root-field comparison predicates.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param where - Equality shorthand, operator objects, or `$and` expressions.
 * @returns The quoted `WHERE` clause and its parameter values.
 * @throws {Error} When the entity, field, operator, or value is invalid.
 */
function whereClause(
  entities: EntityDefinitions,
  entityName: string,
  where: Readonly<Record<string, unknown>> = {},
): SQLPredicate {
  const entity = definition(entities, entityName)
  if (!isPlainRecord(where)) throw new Error('Query where must be a plain object')

  const comparisons = expression(entity, where)
  const values: unknown[] = []
  const predicates = comparisons.map(entry => {
    const column = quoteIdentifier(entry.field.name)
    if (entry.operator === '$eq' && entry.value === null) return `${column} IS NULL`

    values.push(entry.value)
    return `${column} ${comparisonOperator(entry.operator)} $${values.length}`
  })

  return {
    sql: predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '',
    values,
  }
}

/**
 * Normalize supported where syntax into one implicit-AND comparison list.
 * @param entity - Entity whose fields are referenced.
 * @param where - Equality shorthand, operator objects, or `$and` expressions.
 * @returns The normalized comparisons.
 */
function expression(
  entity: EntityDefinition,
  where: Readonly<Record<string, unknown>>,
): Comparison[] {
  if (!isPlainRecord(where)) throw new Error('Query where must be a plain object')

  const fields = new Map(entity.fields.map(field => [field.name, field]))
  const comparisons: Comparison[] = []

  for (const [name, value] of Object.entries(where)) {
    if (name === '$and') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Query $and must be a non-empty array')
      }
      for (const operand of value) {
        if (!isPlainRecord(operand)) throw new Error('Query $and operands must be plain objects')
        comparisons.push(...expression(entity, operand))
      }
      continue
    }

    if (name.startsWith('$')) throw new Error(`Query operator "${name}" is not supported`)
    const field = fields.get(name)
    if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)

    if (isPlainRecord(value)) {
      const entries = Object.entries(value)
      if (entries.length === 0) {
        throw new Error(`Query condition "${entity.name}.${name}" must include an operator`)
      }
      for (const [operator, operand] of entries) {
        if (!COMPARISON_OPERATORS.has(operator)) {
          throw new Error(`Query operator "${operator}" is not supported`)
        }
        comparisons.push(comparison(field, operator as ComparisonOperator, operand))
      }
      continue
    }

    if (value === undefined) {
      throw new Error(`Query condition "${entity.name}.${name}" must not be undefined`)
    }
    comparisons.push(comparison(field, '$eq', value))
  }

  return comparisons
}

/**
 * Validate one field comparison and its value.
 * @param field - Field being compared.
 * @param operator - Comparison operator.
 * @param value - Comparison value.
 * @returns The normalized comparison.
 */
function comparison(
  field: FieldDefinition,
  operator: ComparisonOperator,
  value: unknown,
): Comparison {
  if (value === undefined) {
    throw new Error(`Query condition "${field.name}" must not be undefined`)
  }
  if (value === null) {
    if (operator !== '$eq') {
      throw new Error(`Query operator "${operator}" requires a non-null value`)
    }
    return { field, operator, value }
  }
  if (isPlainRecord(value) || Array.isArray(value)) {
    throw new Error(`Query condition "${field.name}" must be a scalar value`)
  }
  if (RANGE_OPERATORS.has(operator) && !RANGE_TYPES.has(field.type)) {
    throw new Error(`Query operator "${operator}" is not valid for field "${field.name}"`)
  }
  return { field, operator, value }
}

/**
 * Map a normalized comparison operator to PostgreSQL syntax.
 * @param operator - Comparison operator.
 * @returns The SQL comparison operator.
 */
function comparisonOperator(operator: ComparisonOperator): string {
  switch (operator) {
    case '$eq': return '='
    case '$gt': return '>'
    case '$gte': return '>='
    case '$lt': return '<'
    case '$lte': return '<='
    default: throw new Error(`Unsupported comparison operator: ${operator}`)
  }
}

/**
 * Whether a value is a plain object.
 * @param value - Candidate value.
 * @returns `true` for a non-array object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
