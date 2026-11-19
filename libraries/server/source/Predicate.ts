import type { ArrayFieldDefinition, EntityDefinition, QueryFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './FieldType'
import { Operator } from './Operator'
import { normalizeScalar } from './ScalarNormalization'

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
  /** Nested native-array navigations available to members. */
  readonly array?: ArrayResolver,
  /** Nested collection navigations available to members. */
  readonly collection?: CollectionResolver,
  /** Related item entity type. */
  readonly definition: EntityDefinition,
  /** Resolve one inner value field or path. */
  readonly field: (name: string) => QueryFieldDefinition,
}

/** Resolve a collection navigation for filter normalization. */
export type CollectionResolver = (name: string) => CollectionFilterScope | undefined

/** Entity-shaped context used to normalize a native-array member predicate. */
export interface ArrayFilterScope {
  /** Native array field. */
  readonly field: ArrayFieldDefinition,
  /** Scalar element definition. */
  readonly member: ScalarFieldDefinition,
}

/** Resolve a native array for filter normalization. */
export type ArrayResolver = (name: string) => ArrayFilterScope | undefined

/** Canonical field name for the authenticated-actor sentinel. */
export const ACTOR_FIELD_NAME = '$me'

/** The synthetic identity field used by actor-presence predicates. */
export const ACTOR_FIELD: ScalarFieldDefinition = Object.freeze({
  name: ACTOR_FIELD_NAME,
  type: 'ID' as FieldType.ID,
})

/** A canonical right-hand field reference inside a comparison. */
export interface FieldOperand {
  /** Canonical logical path to the referenced field. */
  readonly $field: string,
}

/** A canonical serializable where filter. */
export type Filter = CollectionFilter | ComparisonFilter | LogicalFilter

/**
 * Whether an operand is a canonical field reference.
 * @param value - Candidate operand.
 * @returns `true` for a field-reference operand.
 */
export function isFieldOperand(value: unknown): value is FieldOperand {
  return isPlainRecord(value)
    && Object.keys(value).length === 1
    && typeof value.$field === 'string'
}

/**
 * Whether an operand is the canonical actor sentinel.
 * @param value - Candidate operand.
 * @returns `true` for `$me`.
 */
export function isActorOperand(value: unknown): boolean {
  return value === ACTOR_FIELD_NAME
}

/** Maximum number of elements accepted in one array operand. */
const MAX_ARRAY_OPERAND = 128

/** Primitive comparison operators retained in the canonical filter tree. */
const BASE_COMPARISON_OPERATORS = new Set<Operator.Comparison>([
  Operator.Comparison.Contains,
  Operator.Comparison.Equal,
  Operator.Comparison.In,
  Operator.Comparison.Overlaps,
  Operator.Comparison.SequenceEqual,
  Operator.Comparison.GreaterThan,
  Operator.Comparison.GreaterThanOrEqual,
  Operator.Comparison.LessThan,
  Operator.Comparison.LessThanOrEqual,
])

/** Scalar field types that support equality. */
const SCALAR_FIELD_TYPES = new Set<FieldType>([
  FieldType.Boolean,
  FieldType.Date,
  FieldType.Enum,
  FieldType.ID,
  FieldType.Number,
  FieldType.String,
  FieldType.Timestamp,
])
/** Scalar and native-array fields that support equality. */
const EQUAL_FIELD_TYPES = new Set<FieldType>([...SCALAR_FIELD_TYPES, FieldType.Array])
/** Native-array fields. */
const ARRAY_FIELD_TYPES = new Set<FieldType>([FieldType.Array])
/** Fields that support substring or membership containment. */
const CONTAINS_FIELD_TYPES = new Set<FieldType>([
  FieldType.Array,
  FieldType.JSON,
  FieldType.String,
])
/** Ordered scalar field types. */
const RANGE_FIELD_TYPES = new Set<FieldType>([
  FieldType.Date,
  FieldType.ID,
  FieldType.Number,
  FieldType.String,
  FieldType.Timestamp,
])

/** The canonical operand and field-type contract for one comparison operator. */
export interface ComparisonOperatorDefinition {
  /** Field types the operator supports. */
  readonly allowedFieldTypes: ReadonlySet<FieldType>,
  /** Validate and normalize one raw operand. */
  readonly operand: (field: QueryFieldDefinition, raw: unknown) => unknown,
}

/**
 * The authoritative comparison-operator contract.
 *
 * SQL compilation supplies only the physical renderer; field-type
 * compatibility and operand semantics live here.
 */
const comparisonOperators = new Map<Operator.Comparison, ComparisonOperatorDefinition>([
  [Operator.Comparison.Equal, { allowedFieldTypes: EQUAL_FIELD_TYPES, operand: equalOperand }],
  [Operator.Comparison.NotEqual, { allowedFieldTypes: EQUAL_FIELD_TYPES, operand: notEqualOperand }],
  [Operator.Comparison.SequenceEqual, {
    allowedFieldTypes: ARRAY_FIELD_TYPES,
    operand: sequenceEqualOperand,
  }],
  [Operator.Comparison.Contains, {
    allowedFieldTypes: CONTAINS_FIELD_TYPES,
    operand: containsOperand,
  }],
  [Operator.Comparison.In, { allowedFieldTypes: SCALAR_FIELD_TYPES, operand: inOperand }],
  [Operator.Comparison.Overlaps, { allowedFieldTypes: ARRAY_FIELD_TYPES, operand: overlapsOperand }],
  [Operator.Comparison.Empty, { allowedFieldTypes: ARRAY_FIELD_TYPES, operand: emptyOperand }],
  [Operator.Comparison.GreaterThan, {
    allowedFieldTypes: RANGE_FIELD_TYPES,
    operand: rangeOperand(Operator.Comparison.GreaterThan),
  }],
  [Operator.Comparison.GreaterThanOrEqual, {
    allowedFieldTypes: RANGE_FIELD_TYPES,
    operand: rangeOperand(Operator.Comparison.GreaterThanOrEqual),
  }],
  [Operator.Comparison.LessThan, {
    allowedFieldTypes: RANGE_FIELD_TYPES,
    operand: rangeOperand(Operator.Comparison.LessThan),
  }],
  [Operator.Comparison.LessThanOrEqual, {
    allowedFieldTypes: RANGE_FIELD_TYPES,
    operand: rangeOperand(Operator.Comparison.LessThanOrEqual),
  }],
])

/** Read the authoritative comparison-operator contract. */
export const ComparisonOperators = {
  /**
   * Return one operator's contract.
   * @param operator - Comparison operator identity.
   * @returns The contract, or undefined when unsupported.
   */
  definition(operator: Operator.Comparison): ComparisonOperatorDefinition | undefined {
    return comparisonOperators.get(operator)
  },

  /**
   * Whether a field supports one comparison operator.
   * @param field - Candidate query field.
   * @param operator - Comparison operator identity.
   * @returns `true` when the operator accepts the field type.
   */
  supports(field: QueryFieldDefinition, operator: Operator.Comparison): boolean {
    return comparisonOperators.get(operator)?.allowedFieldTypes.has(field.type) ?? false
  },
}

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
  empty(entity: EntityDefinition, field: QueryFieldDefinition): Filter {
    if (field.type === FieldType.Array) {
      return { field: field.name, operator: Operator.Comparison.Empty, value: null }
    }
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
  field(entity: EntityDefinition, name: string): QueryFieldDefinition {
    if (name === ACTOR_FIELD_NAME) return ACTOR_FIELD
    const field = entity.fields.find(candidate => candidate.name === name)
    if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)
    if (field.type === FieldType.Entity) {
      return { name: field.column, type: FieldType.ID }
    }
    if (field.type === FieldType.Collection) {
      throw new Error(
        `Query field "${entity.name}.${name}" is a collection navigation; ` +
        'navigation fields cannot be used in predicates or ordering',
      )
    }
    if (field.type === FieldType.Inverse) {
      throw new Error(
        `Query field "${entity.name}.${name}" is an inverse navigation; ` +
        'navigation fields cannot be used in predicates or ordering',
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
   * @param array - Resolve native arrays to member metadata.
   * @returns The canonical filter, or null for an empty object.
   * @throws {Error} When the input shape, field, or operator is invalid.
   */
  normalize(
    entity: EntityDefinition,
    input: Filter | Readonly<Record<string, unknown>>,
    resolve: (name: string) => QueryFieldDefinition = name => Predicate.field(entity, name),
    collection?: CollectionResolver,
    array?: ArrayResolver,
  ): Filter | null {
    if (!isPlainRecord(input)) throw new Error('Query where must be a plain object')
    if (Object.hasOwn(input, 'operator')) return explicit(entity, input, resolve, collection, array)
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
   * Validate and normalize one comparison operand against its field.
   * @param field - Target value field.
   * @param operator - Comparison operator identity.
   * @param raw - Raw structured or source operand.
   * @returns The canonical scalar, array, or JSON operand.
   * @throws {Error} When the operand is incompatible with the field.
   */
  operand(
    field: QueryFieldDefinition,
    operator: Operator.Comparison,
    raw: unknown,
  ): unknown {
    const definition = ComparisonOperators.definition(operator)
    if (!definition) throw new Error(`Query operator "${operator}" is not supported`)
    if (!definition.allowedFieldTypes.has(field.type)) {
      throw new Error(`Query operator "${operator}" is not valid for field "${field.name}"`)
    }
    return definition.operand(field, raw)
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
  resolve: (name: string) => QueryFieldDefinition,
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
 * @param array - Resolve native arrays to member metadata.
 * @returns The canonical filter node.
 */
function explicit(
  entity: EntityDefinition,
  input: Readonly<Record<string, unknown>>,
  resolve: (name: string) => QueryFieldDefinition,
  collection?: CollectionResolver,
  array?: ArrayResolver,
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
        child(
          collectionScope.definition,
          operator,
          filter,
          collectionScope.field,
          collectionScope.collection,
          collectionScope.array,
        )
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
  const arrayScope = typeof input.field === 'string'
    ? array?.(input.field)
    : undefined
  if (arrayScope && Array.isArray(input.filters)
    && (operator === Operator.Comparison.Contains || operator === Operator.Collection.All)) {
    assertKeys(input, ['field', 'filters', 'operator'])
    if (!Array.isArray(input.filters) || input.filters.length === 0) {
      throw new Error(`Query ${operator} requires a non-empty filters array`)
    }
    const member = arrayMemberField(arrayScope.member)
    const memberEntity = arrayMemberEntity(arrayScope.field, member)
    const filters = input.filters.map(filter => (
      child(memberEntity, operator, filter, name => arrayMemberResolver(name, member))
    ))
    if (operator === Operator.Collection.All) return Predicate.universal(input.field as string, filters)
    return { field: input.field as string, filters, operator }
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
      input.filters.map(filter => child(entity, operator, filter, resolve, collection, array)),
    )
  }

  if (operator === Operator.Logical.Not) {
    assertKeys(input, ['operator', 'filters'])
    if (!Array.isArray(input.filters) || input.filters.length !== 1) {
      throw new Error(`Query ${Operator.Logical.Not} requires exactly one filter`)
    }
    return Predicate.not(child(entity, operator, input.filters[0], resolve, collection, array))
  }

  if (operator === Operator.Comparison.NotEqual) {
    assertKeys(input, ['operator', 'field', 'value'])
    const definition = requireField(entity, input, resolve)
    return Predicate.notEqual(
      definition.name,
      Predicate.operand(definition, Operator.Comparison.NotEqual, input.value),
    )
  }

  if (operator === Operator.Comparison.Between) {
    assertKeys(input, ['operator', 'field', 'values'])
    const definition = requireField(entity, input, resolve)
    if (definition.type === FieldType.Array || definition.type === FieldType.JSON) {
      throw new Error(`Query ${Operator.Comparison.Between} is not valid for field "${definition.name}"`)
    }
    if (!Array.isArray(input.values) || input.values.length !== 2) {
      throw new Error(`Query ${Operator.Comparison.Between} requires exactly two values`)
    }
    const [lower, upper] = input.values
    return Predicate.between(definition.name, lower, upper)
  }

  if (operator === Operator.Comparison.Empty) {
    const definition = requireField(entity, input, resolve)
    const canonical = definition.type === FieldType.Array
      && input.value === null
      && Object.hasOwn(input, 'value')
    assertKeys(input, canonical ? ['operator', 'field', 'value'] : ['operator', 'field'])
    return Predicate.empty(entity, definition)
  }

  if (!BASE_COMPARISON_OPERATORS.has(operator as Operator.Comparison)) {
    throw new Error(`Query operator "${operator}" is not supported`)
  }

  assertKeys(input, ['operator', 'field', 'value'])
  const definition = requireField(entity, input, resolve)
  return {
    field: definition.name,
    operator: operator as Operator.Comparison,
    value: Predicate.operand(definition, operator as Operator.Comparison, input.value),
  }
}

/**
 * Normalize one logical child.
 * @param entity - Entity whose fields are referenced.
 * @param operator - Parent logical operator identity.
 * @param filter - Child filter input.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @param collection - Resolve collection navigations to related-item metadata.
 * @param array - Resolve native arrays to member metadata.
 * @returns The normalized child filter.
 */
function child(
  entity: EntityDefinition,
  operator: string,
  filter: unknown,
  resolve: (name: string) => QueryFieldDefinition,
  collection?: CollectionResolver,
  array?: ArrayResolver,
): Filter {
  if (!isPlainRecord(filter)) throw new Error(`Query ${operator} filters must be plain objects`)
  const normalized = Predicate.normalize(entity, filter, resolve, collection, array)
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
  resolve: (name: string) => QueryFieldDefinition,
): QueryFieldDefinition {
  if (typeof input.field !== 'string') throw new Error('Query comparison field must be a string')
  if (input.field === ACTOR_FIELD_NAME) return ACTOR_FIELD
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
 * Build the canonical synthetic entity for one array member predicate.
 * @param field - Native array field.
 * @param member - Canonical member field.
 * @returns A synthetic entity whose only field is the scoped member.
 */
export function arrayMemberEntity(
  field: ArrayFieldDefinition,
  member: ScalarFieldDefinition,
): EntityDefinition {
  return {
    abstract: false,
    collections: [],
    constraints: [],
    effectiveFields: [{ ...member, owner: 'Entity' }],
    fields: [member],
    inverseFields: [],
    name: field.name,
    parent: 'Entity',
    singularNavigations: [],
  }
}

/**
 * Build the canonical scoped member field.
 * @param member - Native array element definition.
 * @returns The member field named `@`.
 */
export function arrayMemberField(member: ScalarFieldDefinition): ScalarFieldDefinition {
  return { ...member, name: '@' }
}

/**
 * Resolve the only field allowed in a native-array member predicate.
 * @param name - Requested scoped path.
 * @param member - Canonical member field.
 * @returns The member field.
 */
export function arrayMemberResolver(
  name: string,
  member: ScalarFieldDefinition,
): ScalarFieldDefinition {
  if (name !== '@') throw new Error(`Unknown scoped member field "${name}"`)
  return member
}

/**
 * Normalize an equality operand.
 * @param field - Target field.
 * @param raw - Raw operand.
 * @returns The normalized operand.
 */
function equalOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  return field.type === FieldType.Array
    ? arrayOperand(field, Operator.Comparison.Equal, raw)
    : scalarOperand(field, Operator.Comparison.Equal, raw, true)
}

/**
 * Normalize a not-equal operand before it lowers to `Not(Equal)`.
 * @param field - Target field.
 * @param raw - Raw operand.
 * @returns The normalized operand.
 */
function notEqualOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  return field.type === FieldType.Array
    ? arrayOperand(field, Operator.Comparison.NotEqual, raw)
    : scalarOperand(field, Operator.Comparison.NotEqual, raw, true)
}

/**
 * Normalize a sequence-equality operand.
 * @param field - Target array field.
 * @param raw - Raw operand.
 * @returns The normalized element list.
 */
function sequenceEqualOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  return arrayOperand(field as ArrayFieldDefinition, Operator.Comparison.SequenceEqual, raw)
}

/**
 * Normalize a containment operand.
 * @param field - Target array, JSON, or string field.
 * @param raw - Raw operand.
 * @returns The normalized operand.
 */
function containsOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  if (field.type === FieldType.Array) return arrayOperand(field, Operator.Comparison.Contains, raw)
  if (field.type === FieldType.JSON) return normalizeJSON(raw)
  return scalarOperand(field, Operator.Comparison.Contains, raw, false)
}

/**
 * Normalize an overlap operand.
 * @param field - Target array field.
 * @param raw - Raw operand.
 * @returns The normalized element list.
 */
function overlapsOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  return arrayOperand(field as ArrayFieldDefinition, Operator.Comparison.Overlaps, raw)
}

/**
 * Normalize an empty operand.
 * @returns `null`; emptiness is decided by the physical renderer.
 */
function emptyOperand(): null {
  return null
}

/**
 * Build one ordered-comparison operand strategy.
 * @param operator - Range operator identity.
 * @returns The operand strategy for that operator.
 */
function rangeOperand(
  operator: Operator.Comparison,
): (field: QueryFieldDefinition, raw: unknown) => unknown {
  return (field, raw) => scalarOperand(field, operator, raw, false)
}

/**
 * Normalize one scalar operand against its field.
 * @param field - Target scalar field.
 * @param operator - Comparison operator identity.
 * @param raw - Raw operand.
 * @param allowNull - Whether null is a valid equality operand.
 * @returns The normalized scalar or field-reference operand.
 */
function scalarOperand(
  field: QueryFieldDefinition,
  operator: Operator.Comparison,
  raw: unknown,
  allowNull: boolean,
): unknown {
  if (raw === undefined) throw new Error(`Query operand for "${field.name}" must not be undefined`)
  if (field.name === ACTOR_FIELD_NAME) {
    if (allowNull && raw === null) return null
    throw new Error('Query operand for "$me" must compare actor presence with null')
  }
  if (isFieldOperand(raw)) {
    if (operator === Operator.Comparison.Contains) {
      throw new Error(`Query operator "${operator}" does not accept a field reference operand`)
    }
    assertFieldPath(raw.$field)
    return { $field: raw.$field }
  }
  if (field.type === FieldType.Enum) {
    if (typeof raw !== 'string') invalidOperand(field)
    return raw
  }
  if (raw === '$me') {
    if (field.type === FieldType.ID) return raw
    throw new Error('Query operand "$me" is only valid for identity fields')
  }
  if (raw === null) {
    if (allowNull) return null
    throw new Error(`Query operand for "${field.name}" must not be null`)
  }
  const normalized = normalizeScalar(field as ScalarFieldDefinition, raw)
  if (normalized === undefined) invalidOperand(field)
  return normalized
}

/**
 * Normalize one scalar membership operand.
 * @param field - Target scalar field.
 * @param raw - Raw array operand.
 * @returns Normalized element values in operand order.
 * @throws {Error} When the list shape or an element is invalid.
 */
function inOperand(field: QueryFieldDefinition, raw: unknown): unknown {
  if (field.name === ACTOR_FIELD_NAME) {
    throw new Error('Query operand for "$me" must compare actor presence with null')
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Query operator "${Operator.Comparison.In}" requires an array operand for "${field.name}"`)
  }
  if (raw.length === 0) {
    throw new Error(`Query operator "${Operator.Comparison.In}" requires a non-empty array operand for "${field.name}"`)
  }
  if (raw.length > MAX_ARRAY_OPERAND) {
    throw new Error(`Array operand for "${field.name}" exceeds the maximum of ${MAX_ARRAY_OPERAND} elements`)
  }
  return raw.map(value => {
    if (value === null) {
      throw new Error(`Query ${Operator.Comparison.In} operands for "${field.name}" cannot contain null`)
    }
    if (Array.isArray(value)) {
      throw new Error(
        `Query ${Operator.Comparison.In} operands for "${field.name}" must contain only scalar values`,
      )
    }
    if (isFieldOperand(value)) {
      throw new Error(
        `Query ${Operator.Comparison.In} operands for "${field.name}" must not contain field references`,
      )
    }
    if (field.type === FieldType.Enum) {
      if (typeof value !== 'string') invalidOperand(field)
      return value
    }
    if (value === ACTOR_FIELD_NAME) {
      if (field.type === FieldType.ID) return value
      throw new Error('Query operand "$me" is only valid for identity fields')
    }
    const normalized = normalizeScalar(field as ScalarFieldDefinition, value)
    if (normalized === undefined) invalidOperand(field)
    return normalized
  })
}

/**
 * Normalize one array operand.
 * @param field - Native array field.
 * @param operator - Comparison operator identity.
 * @param raw - Raw scalar or array operand.
 * @returns Normalized element values in operand order.
 */
function arrayOperand(
  field: ArrayFieldDefinition,
  operator: Operator.Comparison,
  raw: unknown,
): unknown {
  if (raw === null) {
    if (operator === Operator.Comparison.Equal || operator === Operator.Comparison.NotEqual) return null
    throw new Error(`Query operand for "${field.name}" must not be null`)
  }
  const allowScalar = operator === Operator.Comparison.Contains || operator === Operator.Comparison.Overlaps
  const values = Array.isArray(raw) ? raw : allowScalar ? [raw] : undefined
  if (!values) throw new Error(`Query operator "${operator}" requires an array operand for "${field.name}"`)
  if (values.length > MAX_ARRAY_OPERAND) {
    throw new Error(`Array operand for "${field.name}" exceeds the maximum of ${MAX_ARRAY_OPERAND} elements`)
  }
  const item = arrayItemField(field)
  return values.map(value => {
    if (value === null) throw new Error(`Array operands for "${field.name}" cannot contain null`)
    const normalized = normalizeScalar(item, value)
    if (normalized === undefined) invalidOperand(item)
    return normalized
  })
}

/**
 * Build the scalar definition for one array element.
 * @param field - Native array field.
 * @returns Its scalar element definition.
 */
export function arrayItemField(field: ArrayFieldDefinition): ScalarFieldDefinition {
  return {
    ...(field.items.format ? { format: field.items.format } : {}),
    name: field.name,
    type: field.items.type,
  }
}

/**
 * Normalize a JSON-compatible operand recursively.
 * @param value - Candidate JSON value.
 * @param seen - Cycle detector.
 * @returns A JSON-compatible clone.
 */
function normalizeJSON(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON number operands must be finite')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error('JSON integer operands exceed the safe integer range')
    }
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('JSON operands cannot be cyclic')
    seen.add(value)
    const normalized = value.map(item => normalizeJSON(item, seen))
    seen.delete(value)
    return normalized
  }
  if (typeof value !== 'object') {
    throw new Error('JSON operands must contain only JSON-compatible values')
  }
  if (seen.has(value)) throw new Error('JSON operands cannot be cyclic')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('JSON operands must contain only plain objects')
  }
  seen.add(value)
  const normalized = Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeJSON(entry, seen)]),
  )
  seen.delete(value)
  return normalized
}

/**
 * Throw the standard operand error.
 * @param field - Field whose operand is invalid.
 * @param field.name - Field name used in the diagnostic.
 * @param field.type - Field type used in the diagnostic.
 * @throws {Error} Always, naming the invalid operand.
 */
function invalidOperand(field: { readonly name: string, readonly type: string }): never {
  throw new Error(`Query operand for "${field.name}" is not a valid ${field.type.toLowerCase()} value`)
}

/**
 * Require a syntactically valid field-reference path.
 * @param path - Candidate logical path.
 * @throws {Error} When the path is empty or has an empty segment.
 */
function assertFieldPath(path: string): void {
  if (path.split('.').some(segment => segment.length === 0)) {
    throw new Error(`Query field reference "${path}" is not a valid path`)
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
