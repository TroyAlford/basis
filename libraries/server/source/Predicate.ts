import type { EntityDefinition } from './EntityDefinitions'
import { Operator } from './Operator'

/** A canonical comparison filter. */
export interface ComparisonFilter {
  /** Root entity field name. */
  readonly field: string,
  /** Comparison operator identity. */
  readonly operator: Operator.Comparison,
  /** Comparison value. */
  readonly value: unknown,
}

/** A canonical logical filter group. */
export interface LogicalFilter {
  /** Child filters. */
  readonly filters: readonly Filter[],
  /** Logical operator identity. */
  readonly operator: Operator.Logical,
}

/** A canonical serializable where filter. */
export type Filter = ComparisonFilter | LogicalFilter

/** Comparison operators implemented by structured filters. */
const COMPARISON_OPERATORS = new Set<Operator.Comparison>([
  Operator.Comparison.Equal,
  Operator.Comparison.GreaterThan,
  Operator.Comparison.GreaterThanOrEqual,
  Operator.Comparison.LessThan,
  Operator.Comparison.LessThanOrEqual,
])

/**
 * Normalize structured where input into the canonical filter tree.
 *
 * This is the only structured-input normalizer. SQL rendering and parameter
 * binding belong to the SQL construction owner.
 */
export const Predicate = {
  /**
   * Expand a source-level comparison into one canonical filter.
   * @param field - Root entity field name.
   * @param lower - Inclusive lower bound, or null for an open bound.
   * @param upper - Inclusive upper bound, or null for an open bound.
   * @returns The canonical range filter.
   * @throws {Error} When both bounds are null.
   */
  between(field: string, lower: unknown, upper: unknown): Filter {
    if (lower === null && upper === null) throw new Error('Between requires at least one non-null bound')
    const filters: Filter[] = []
    if (lower !== null) {
      filters.push({ field, operator: Operator.Comparison.GreaterThanOrEqual, value: lower })
    }
    if (upper !== null) {
      filters.push({ field, operator: Operator.Comparison.LessThanOrEqual, value: upper })
    }
    return filters.length === 1 ? filters[0] as Filter : Predicate.logical(Operator.Logical.And, filters)
  },

  /**
   * Expand the empty-string comparison into canonical equality nodes.
   * @param field - Root entity field name.
   * @returns `Or(Equal(null), Equal(''))`.
   */
  empty(field: string): LogicalFilter {
    return Predicate.logical(Operator.Logical.Or, [
      { field, operator: Operator.Comparison.Equal, value: null },
      { field, operator: Operator.Comparison.Equal, value: '' },
    ])
  },

  /**
   * Build a logical filter group.
   * @param operator - Logical operator identity.
   * @param filters - Child filters.
   * @returns The logical filter group.
   */
  logical(operator: Operator.Logical, filters: readonly Filter[]): LogicalFilter {
    return { filters, operator }
  },

  /**
   * Normalize a where input.
   * @param entity - Entity whose fields are referenced.
   * @param input - A single-field equality shorthand or an explicit filter.
   * @returns The canonical filter, or null for an empty object.
   * @throws {Error} When the input shape, field, or operator is invalid.
   */
  normalize(entity: EntityDefinition, input: Filter | Readonly<Record<string, unknown>>): Filter | null {
    if (!isPlainRecord(input)) throw new Error('Query where must be a plain object')
    if (Object.hasOwn(input, 'operator')) return explicit(entity, input)
    return shorthand(entity, input)
  },

  /**
   * Negate one filter.
   * @param filter - Filter to negate.
   * @returns The one-child `Not` group.
   */
  not(filter: Filter): LogicalFilter {
    return Predicate.logical(Operator.Logical.Not, [filter])
  },

  /**
   * Expand a source-level not-equal comparison into `Not(Equal)`.
   * @param field - Root entity field name.
   * @param value - Value that must not match.
   * @returns The canonical negated equality filter.
   */
  notEqual(field: string, value: unknown): LogicalFilter {
    return Predicate.not({ field, operator: Operator.Comparison.Equal, value })
  },
}

/**
 * Normalize a single-field equality shorthand object.
 * @param entity - Entity whose fields are referenced.
 * @param input - Shorthand object.
 * @returns The comparison filter, or null for an empty object.
 */
function shorthand(entity: EntityDefinition, input: Readonly<Record<string, unknown>>): Filter | null {
  const entries = Object.entries(input)
  if (entries.length === 0) return null
  if (entries.length > 1) {
    throw new Error(
      'Query shorthand must contain exactly one field; use Operator.Logical.And with filters for multiple conditions',
    )
  }

  const [field, value] = entries[0] as [string, unknown]
  assertField(entity, field)
  return { field, operator: Operator.Comparison.Equal, value }
}

/**
 * Normalize an explicit operator-tagged filter node.
 * @param entity - Entity whose fields are referenced.
 * @param input - Explicit node input.
 * @returns The canonical filter node.
 */
function explicit(entity: EntityDefinition, input: Readonly<Record<string, unknown>>): Filter {
  const operator = input.operator
  if (typeof operator !== 'string') throw new Error('Query operator must be a string')

  if (operator === Operator.Logical.And) {
    assertKeys(input, ['operator', 'filters'])
    if (!Array.isArray(input.filters) || input.filters.length === 0) {
      throw new Error(`Query ${Operator.Logical.And} requires a non-empty filters array`)
    }
    const filters = input.filters.map(filter => {
      if (!isPlainRecord(filter)) throw new Error(`Query ${Operator.Logical.And} filters must be plain objects`)
      const normalized = Predicate.normalize(entity, filter)
      if (!normalized) throw new Error(`Query ${Operator.Logical.And} filters must be non-empty objects`)
      return normalized
    })
    return { filters, operator: Operator.Logical.And }
  }

  if (!COMPARISON_OPERATORS.has(operator as Operator.Comparison)) {
    throw new Error(`Query operator "${operator}" is not supported`)
  }

  assertKeys(input, ['operator', 'field', 'value'])
  if (typeof input.field !== 'string') throw new Error('Query comparison field must be a string')
  assertField(entity, input.field)
  return {
    field: input.field,
    operator: operator as Operator.Comparison,
    value: input.value,
  }
}

/**
 * Verify that a field belongs to the entity.
 * @param entity - Entity whose fields are referenced.
 * @param field - Field name to verify.
 */
function assertField(entity: EntityDefinition, field: string): void {
  if (!entity.fields.some(candidate => candidate.name === field)) {
    throw new Error(`Unknown field "${entity.name}.${field}"`)
  }
}

/**
 * Require an object's exact keys.
 * @param value - Object being checked.
 * @param keys - Required keys.
 */
function assertKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Query ${String(value.operator)} requires exactly ${keys.join(', ')}`)
  }
}

/**
 * Whether a value is a plain object, excluding dates and arrays.
 * @param value - Candidate value.
 * @returns `true` for a plain object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
