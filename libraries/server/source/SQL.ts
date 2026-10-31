import type { EntityDefinition, EntityDefinitions, FieldDefinition } from './EntityDefinitions'

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
export interface OrderBy {
  /** Sort direction; defaults to ascending. */
  readonly direction?: 'asc' | 'desc',
  /** Root field to sort by. */
  readonly field: string,
}

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

/**
 * Build parameterized root-field equality predicates.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param where - Root-field equality values, combined with `AND`.
 * @returns The quoted `WHERE` clause and its parameter values.
 * @throws {Error} When the entity or predicate field is unknown or a value is nullish.
 */
function whereClause(
  entities: EntityDefinitions,
  entityName: string,
  where: Readonly<Record<string, unknown>> = {},
): SQLPredicate {
  const entity = definition(entities, entityName)
  if (typeof where !== 'object' || where === null || Array.isArray(where)) {
    throw new Error('Query where must be a plain object')
  }

  const definitions = new Set(entity.fields.map(field => field.name))
  const values: unknown[] = []
  const predicates = Object.entries(where).map(([field, value]) => {
    if (!definitions.has(field)) throw new Error(`Unknown field "${entityName}.${field}"`)
    if (value === null || value === undefined) {
      throw new Error(`Query condition "${entityName}.${field}" must not be null or undefined`)
    }
    values.push(value)
    return `${quoteIdentifier(field)} = $${values.length}`
  })

  return {
    sql: predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '',
    values,
  }
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
  if (typeof orderBy !== 'object' || orderBy === null) {
    throw new Error('Query orderBy must be an object')
  }

  const entity = definition(entities, entityName)
  if (!entity.fields.some(field => field.name === orderBy.field)) {
    throw new Error(`Unknown field "${entityName}.${orderBy.field}"`)
  }

  const direction = orderBy.direction ?? 'asc'
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error('Query orderBy direction must be "asc" or "desc"')
  }

  return { sql: `ORDER BY ${quoteIdentifier(orderBy.field)} ${direction.toUpperCase()}` }
}

/**
 * Build a validated parameterized pagination clause.
 * @param limit - Maximum rows to return, when requested.
 * @param offset - Rows to skip, when requested.
 * @param startIndex - Number of prior parameter values.
 * @returns The quoted pagination clause and its parameter values.
 * @throws {Error} When limit or offset is not a non-negative integer.
 */
function paginate(
  limit?: number,
  offset?: number,
  startIndex = 0,
): SQLPagination {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('Query limit must be a non-negative integer')
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('Query offset must be a non-negative integer')
  }

  const clauses: string[] = []
  const values: unknown[] = []
  if (limit !== undefined) {
    values.push(limit)
    clauses.push(`LIMIT $${startIndex + values.length}`)
  }
  if (offset !== undefined) {
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
