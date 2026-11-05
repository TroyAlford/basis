import type { EntityDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
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

/** A canonical collection comparison filter. */
export interface CollectionFilter {
  /** Collection navigation name. */
  readonly field: string,
  /** Independent member requirements, or empty for an emptiness test. */
  readonly filters: readonly Filter[],
  /** Collection comparison identity. */
  readonly operator:
    | Operator.Collection.All
    | Operator.Comparison.Contains
    | Operator.Comparison.Empty,
}

/** Entity-shaped context used to normalize a collection's inner predicates. */
export interface CollectionFilterScope {
  /** Related item entity type. */
  readonly definition: EntityDefinition,
  /** Resolve one inner scalar field or path. */
  readonly field: (name: string) => ScalarFieldDefinition,
}

/** Resolve a collection navigation for filter normalization. */
export type CollectionResolver = (name: string) => CollectionFilterScope | undefined

/** A canonical serializable where filter. */
export type Filter = CollectionFilter | ComparisonFilter | LogicalFilter

/** Primitive comparison operators retained in the canonical filter tree. */
const BASE_COMPARISON_OPERATORS = new Set<Operator.Comparison>([
  Operator.Comparison.Contains,
  Operator.Comparison.Equal,
  Operator.Comparison.GreaterThan,
  Operator.Comparison.GreaterThanOrEqual,
  Operator.Comparison.LessThan,
  Operator.Comparison.LessThanOrEqual,
])

/**
 * Normalize structured and source-level shorthand into canonical predicates.
 *
 * This is the shared semantic expansion owner. SQL rendering and parameter
 * binding belong to the SQL construction owner.
 */
export const Predicate = {
  /**
   * Expand an inclusive range into primitive comparisons.
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
   * @param entity - Entity whose field is referenced.
   * @param field - String field definition.
   * @returns `Or(Equal(null), Equal(''))`.
   * @throws {Error} When the field is not a string.
   */
  empty(entity: EntityDefinition, field: ScalarFieldDefinition): LogicalFilter {
    if (field.type !== FieldType.String) {
      throw new Error(
        `Query operator "${Operator.Comparison.Empty}" is not valid for field "${entity.name}.${field.name}"`,
      )
    }
    return Predicate.logical(Operator.Logical.Or, [
      { field: field.name, operator: Operator.Comparison.Equal, value: null },
      { field: field.name, operator: Operator.Comparison.Equal, value: '' },
    ])
  },

  /**
   * Require a field from an entity definition.
   * @param entity - Entity whose fields are referenced.
   * @param name - Root field name.
   * @returns The scalar field definition.
   * @throws {Error} When the field is unknown or is an entity reference.
   */
  field(entity: EntityDefinition, name: string): ScalarFieldDefinition {
    const field = entity.fields.find(candidate => candidate.name === name)
    if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)
    if (field.type === FieldType.Entity) {
      throw new Error(
        `Query field "${entity.name}.${name}" is an entity reference; ` +
        'references cannot be used in predicates or ordering',
      )
    }
    if (field.type === FieldType.Inverse) {
      throw new Error(
        `Query field "${entity.name}.${name}" is an inverse navigation; ` +
        'navigation fields cannot be used in predicates or ordering',
      )
    }
    if (field.type === FieldType.Array) {
      throw new Error(
        `Query field "${entity.name}.${name}" is an array; ` +
        'array fields cannot be used in predicates or ordering',
      )
    }
    if (field.type === FieldType.JSON) {
      throw new Error(
        `Query field "${entity.name}.${name}" is JSON; ` +
        'JSON fields cannot be used in predicates or ordering',
      )
    }
    return field
  },

  /**
   * Build a validated logical filter group.
   * @param operator - Logical operator identity.
   * @param filters - Child filters.
   * @returns The logical filter group.
   * @throws {Error} When the operator's child count is invalid.
   */
  logical(operator: Operator.Logical, filters: readonly Filter[]): LogicalFilter {
    if (operator === Operator.Logical.Not && filters.length !== 1) {
      throw new Error(`Query ${Operator.Logical.Not} requires exactly one filter`)
    }
    if (operator !== Operator.Logical.Not && filters.length === 0) {
      throw new Error(`Query ${operator} requires a non-empty filters array`)
    }
    return { filters, operator }
  },

  /**
   * Normalize a where input.
   * @param entity - Entity whose fields are referenced.
   * @param input - A single-field equality shorthand or an explicit filter.
   * @param resolve - Resolve a logical field or path to its scalar definition.
   * @param collection - Resolve collection navigations to related-item metadata.
   * @returns The canonical filter, or null for an empty object.
   * @throws {Error} When the input shape, field, or operator is invalid.
   */
  normalize(
    entity: EntityDefinition,
    input: Filter | Readonly<Record<string, unknown>>,
    resolve: (name: string) => ScalarFieldDefinition = name => Predicate.field(entity, name),
    collection?: CollectionResolver,
  ): Filter | null {
    if (!isPlainRecord(input)) throw new Error('Query where must be a plain object')
    if (Object.hasOwn(input, 'operator')) return explicit(entity, input, resolve, collection)
    return shorthand(entity, input, resolve)
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
   * Expand a not-equal comparison into `Not(Equal)`.
   * @param field - Root entity field name.
   * @param value - Value that must not match.
   * @returns The canonical negated equality filter.
   */
  notEqual(field: string, value: unknown): LogicalFilter {
    return Predicate.not({ field, operator: Operator.Comparison.Equal, value })
  },

  /**
   * Build a canonical universal collection predicate.
   *
   * The canonical form is `Not(Contains(Not(P)))`, so universal and
   * existential collection predicates share one SQL mechanism.
   * @param field - Collection navigation name.
   * @param filters - Exactly one member requirement.
   * @returns The canonical universal collection filter.
   * @throws {Error} When the requirement count is not one.
   */
  universal(field: string, filters: readonly Filter[]): Filter {
    if (filters.length !== 1) {
      throw new Error('Query $all requires exactly one member predicate')
    }
    const [filter] = filters
    return Predicate.not({
      field,
      filters: [Predicate.not(filter as Filter)],
      operator: Operator.Comparison.Contains,
    })
  },
}

/**
 * Normalize a single-field equality shorthand object.
 * @param entity - Entity whose fields are referenced.
 * @param input - Shorthand object.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @returns The comparison filter, or null for an empty object.
 */
function shorthand(
  entity: EntityDefinition,
  input: Readonly<Record<string, unknown>>,
  resolve: (name: string) => ScalarFieldDefinition,
): Filter | null {
  const entries = Object.entries(input)
  if (entries.length === 0) return null
  if (entries.length > 1) {
    throw new Error(
      'Query shorthand must contain exactly one field; use Operator.Logical.And with filters for multiple conditions',
    )
  }

  const [field, value] = entries[0] as [string, unknown]
  resolve(field)
  return { field, operator: Operator.Comparison.Equal, value }
}

/**
 * Normalize an explicit operator-tagged filter node.
 * @param entity - Entity whose fields are referenced.
 * @param input - Explicit node input.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @param collection - Resolve collection navigations to related-item metadata.
 * @returns The canonical filter node.
 */
function explicit(
  entity: EntityDefinition,
  input: Readonly<Record<string, unknown>>,
  resolve: (name: string) => ScalarFieldDefinition,
  collection?: CollectionResolver,
): Filter {
  const operator = input.operator
  if (typeof operator !== 'string') throw new Error('Query operator must be a string')

  const collectionScope = typeof input.field === 'string'
    ? collection?.(input.field)
    : undefined
  if (collectionScope) {
    if (operator === Operator.Comparison.Empty) {
      const canonical = Array.isArray(input.filters) && input.filters.length === 0
      assertKeys(input, canonical ? ['field', 'filters', 'operator'] : ['field', 'operator'])
      return { field: input.field as string, filters: [], operator }
    }
    if (operator === Operator.Comparison.Contains || operator === Operator.Collection.All) {
      assertKeys(input, ['field', 'filters', 'operator'])
      if (!Array.isArray(input.filters) || input.filters.length === 0) {
        throw new Error(`Query ${operator} requires a non-empty filters array`)
      }
      const filters = input.filters.map(filter => (
        child(collectionScope.definition, operator, filter, collectionScope.field)
      ))
      if (operator === Operator.Collection.All) return Predicate.universal(input.field as string, filters)
      return {
        field: input.field as string,
        filters,
        operator,
      }
    }
    throw new Error(
      `Query operator "${operator}" is not valid for collection navigation "${input.field}"`,
    )
  }
  if (operator === Operator.Collection.All) {
    throw new Error(`Unknown collection navigation "${String(input.field)}"`)
  }

  if (operator === Operator.Logical.And || operator === Operator.Logical.Or) {
    assertKeys(input, ['operator', 'filters'])
    if (!Array.isArray(input.filters) || input.filters.length === 0) {
      throw new Error(`Query ${operator} requires a non-empty filters array`)
    }
    return Predicate.logical(
      operator,
      input.filters.map(filter => child(entity, operator, filter, resolve, collection)),
    )
  }

  if (operator === Operator.Logical.Not) {
    assertKeys(input, ['operator', 'filters'])
    if (!Array.isArray(input.filters) || input.filters.length !== 1) {
      throw new Error(`Query ${Operator.Logical.Not} requires exactly one filter`)
    }
    return Predicate.not(child(entity, operator, input.filters[0], resolve, collection))
  }

  if (operator === Operator.Comparison.NotEqual) {
    assertKeys(input, ['operator', 'field', 'value'])
    return Predicate.notEqual(requireField(entity, input, resolve).name, input.value)
  }

  if (operator === Operator.Comparison.Between) {
    assertKeys(input, ['operator', 'field', 'values'])
    const definition = requireField(entity, input, resolve)
    if (!Array.isArray(input.values) || input.values.length !== 2) {
      throw new Error(`Query ${Operator.Comparison.Between} requires exactly two values`)
    }
    const [lower, upper] = input.values
    return Predicate.between(definition.name, lower, upper)
  }

  if (operator === Operator.Comparison.Empty) {
    assertKeys(input, ['operator', 'field'])
    return Predicate.empty(entity, requireField(entity, input, resolve))
  }

  if (!BASE_COMPARISON_OPERATORS.has(operator as Operator.Comparison)) {
    throw new Error(`Query operator "${operator}" is not supported`)
  }

  assertKeys(input, ['operator', 'field', 'value'])
  const definition = requireField(entity, input, resolve)
  return {
    field: definition.name,
    operator: operator as Operator.Comparison,
    value: input.value,
  }
}

/**
 * Normalize one logical child.
 * @param entity - Entity whose fields are referenced.
 * @param operator - Parent logical operator identity.
 * @param filter - Child filter input.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @param collection - Resolve collection navigations to related-item metadata.
 * @returns The normalized child filter.
 */
function child(
  entity: EntityDefinition,
  operator: string,
  filter: unknown,
  resolve: (name: string) => ScalarFieldDefinition,
  collection?: CollectionResolver,
): Filter {
  if (!isPlainRecord(filter)) throw new Error(`Query ${operator} filters must be plain objects`)
  const normalized = Predicate.normalize(entity, filter, resolve, collection)
  if (!normalized) throw new Error(`Query ${operator} filters must be non-empty objects`)
  return normalized
}

/**
 * Require and return a field named by an explicit filter.
 * @param entity - Entity whose fields are referenced.
 * @param input - Explicit node input.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @returns The field definition.
 */
function requireField(
  entity: EntityDefinition,
  input: Readonly<Record<string, unknown>>,
  resolve: (name: string) => ScalarFieldDefinition,
): ScalarFieldDefinition {
  if (typeof input.field !== 'string') throw new Error('Query comparison field must be a string')
  return resolve(input.field)
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
