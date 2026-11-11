import type { ArrayFieldDefinition, EntityDefinition, EntityDefinitions, QueryFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import { postgresScalarType } from './PostgresTypes'
import type { CollectionFilter, ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { arrayItemField, Predicate } from './Predicate'
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

/** Scoped relation used to evaluate one collection comparison. */
export interface CollectionScope {
  /** Correlated join condition against the root occurrence. */
  readonly condition: string,
  /** Consume finite compiler work for one emitted correlated predicate. */
  readonly consume?: (units?: number) => void,
  /** Related item entity definition. */
  readonly definition: EntityDefinition,
  /** Render one inner field expression. */
  readonly expression: (field: QueryFieldDefinition) => string,
  /** Resolve one inner field by name. */
  readonly field: (name: string) => QueryFieldDefinition,
  /** Classify terminal reference identities inside the collection. */
  readonly filterKind?: (name: string) => 'identity' | undefined,
  /** SQL relation containing the related items. */
  readonly relation: string,
  /** Expanded relation join work emitted by this scope. */
  readonly work?: number,
}

/** Count expression forms used to canonicalize collection counts. */
export interface CountScope {
  /** Zero-count predicate. */
  readonly empty: string,
  /** Non-zero existence predicate. */
  readonly exists: string,
  /** Numeric count expression. */
  readonly expression: string,
}

/** Scoped native-array relation used to evaluate one member predicate. */
export interface ArrayScope {
  /** Consume finite compiler work for one emitted member predicate. */
  readonly consume?: (units?: number) => void,
  /** SQL array expression to unnest. */
  readonly expression: string,
  /** Native array field metadata. */
  readonly field: ArrayFieldDefinition,
  /** Scalar element metadata. */
  readonly member: ScalarFieldDefinition,
}

/** Optional effective-field scope for polymorphic entity queries. */
export interface QueryScope {
  /** Resolve a native array navigation for member-predicate compilation. */
  readonly array?: (name: string) => ArrayScope | undefined,
  /** Resolve a collection navigation for collection comparison compilation. */
  readonly collection?: (name: string) => CollectionScope | undefined,
  /** Effective entity metadata used for validation. */
  readonly definition: EntityDefinition,
  /** Render a field expression with physical table qualification. */
  readonly expression: (field: QueryFieldDefinition) => string,
  /** Resolve a root ordering field by name. */
  readonly field: (name: string) => QueryFieldDefinition,
  /** Optional count expression metadata for canonical zero/existence forms. */
  readonly filterCount?: (name: string) => CountScope | undefined,
  /** Optional filter-only resolver for dotted reference paths and descendant fields. */
  readonly filterField?: (name: string) => QueryFieldDefinition,
  /** Optional filter-only classification for reference identities. */
  readonly filterKind?: (name: string) => 'identity' | undefined,
  /** Optional root scalar or count resolver for ordering. */
  readonly orderField?: (name: string) => QueryFieldDefinition,
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
    field: QueryFieldDefinition,
    column: string,
    operand: unknown,
    bind: (value: BoundScalar) => string,
  ) => string,
  /** Validate and normalize the raw operand. */
  readonly validateOperand: (field: QueryFieldDefinition, operator: Operator.Comparison, raw: unknown) => unknown,
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
/** Scalar and native array fields support equality. */
const EQUAL_FIELD_TYPES = new Set<FieldType>([...ALL_FIELD_TYPES, FieldType.Array])
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
    allowedFieldTypes: EQUAL_FIELD_TYPES,
    build: (field, column, operand, bind) => {
      if (field.type === FieldType.Array) {
        if (operand === null) return `${column} IS NULL`
        const rhs = arrayExpression(field, operand, bind)
        return `(${column} IS NOT NULL AND ${column} @> ${rhs} AND ${column} <@ ${rhs})`
      }
      if (operand === null) return `${column} IS NULL`
      return `${column} IS NOT DISTINCT FROM ${bind(operand as BoundScalar)}`
    },
    validateOperand: (field, operator, raw) => Predicate.operand(field, operator, raw),
  }],
  [Operator.Comparison.SequenceEqual, {
    allowedFieldTypes: new Set([FieldType.Array]),
    build: (field, column, operand, bind) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.SequenceEqual}" requires an array field`)
      }
      return `${column} IS NOT DISTINCT FROM ${arrayExpression(field, operand, bind)}`
    },
    validateOperand: (field, operator, raw) => Predicate.operand(field, operator, raw),
  }],
  [Operator.Comparison.Contains, {
    allowedFieldTypes: new Set([FieldType.Array, FieldType.JSON, FieldType.String]),
    build: (field, column, operand, bind) => {
      if (field.type === FieldType.Array) {
        return `${column} @> ${arrayExpression(field, operand, bind)}`
      }
      if (field.type === FieldType.JSON) {
        return `${column} @> ${bind(JSON.stringify(operand))}::text::jsonb`
      }
      const value = operand as string
      const pattern = `%${value.replace(/[\\%_]/gu, '\\$&')}%`
      return `(${column} IS NOT NULL AND ${column} ILIKE ${bind(pattern)} ESCAPE '\\')`
    },
    validateOperand: (field, operator, raw) => Predicate.operand(field, operator, raw),
  }],
  [Operator.Comparison.Overlaps, {
    allowedFieldTypes: new Set([FieldType.Array]),
    build: (field, column, operand, bind) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.Overlaps}" requires an array field`)
      }
      return `${column} && ${arrayExpression(field, operand, bind)}`
    },
    validateOperand: (field, operator, raw) => Predicate.operand(field, operator, raw),
  }],
  [Operator.Comparison.Empty, {
    allowedFieldTypes: new Set([FieldType.Array]),
    build: (field, column) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.Empty}" requires an array field`)
      }
      return `COALESCE(cardinality(${column}), 0) = 0`
    },
    validateOperand: () => null,
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
    build: children => `(NOT COALESCE((${children[0]}), FALSE))`,
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
  const resolve = scope?.filterField ?? (name => (
    scope ? scope.field(name) : queryField(entity, name)
  ))
  const array = scope?.array ?? (name => {
    try {
      const field = queryField(entity, name)
      return field.type === FieldType.Array
        ? { expression: quoteIdentifier(name), field, member: arrayItemField(field) }
        : undefined
    } catch {
      return undefined
    }
  })
  const filter = Predicate.normalize(entity, where, resolve, scope?.collection, array)
  if (!filter) return { sql: '', values: [] }

  const values: BoundScalar[] = []
  const bind = (value: BoundScalar): string => {
    if (value === '$me') return 'nullif(current_setting(\'actor.id\', true), \'\')'
    values.push(value)
    return `$${values.length}`
  }

  const base: QueryScope = scope ?? {
    array,
    definition: entity,
    expression: field => quoteIdentifier(field.name),
    field: name => queryField(entity, name),
  }
  let arrayAlias = 0
  const compile = (node: Filter, active: QueryScope): string => {
    if ('field' in node && 'filters' in node) {
      const collection = active.collection?.(node.field)
      const arrayScope = active.array?.(node.field)
      if (!collection && !arrayScope) {
        throw new Error(`Unknown collection or array navigation "${node.field}"`)
      }
      const collectionFilter = node as CollectionFilter
      if (arrayScope) {
        if (collectionFilter.operator !== Operator.Comparison.Contains
          && collectionFilter.operator !== Operator.Collection.All) {
          throw new Error(`Query operator "${collectionFilter.operator}" is not a canonical array member comparison`)
        }
        if (collectionFilter.filters.length === 0) {
          throw new Error(`Query ${collectionFilter.operator} requires at least one member requirement`)
        }
        arrayAlias += 1
        const alias = quoteIdentifier(`u${arrayAlias}`)
        const memberScope: QueryScope = {
          definition: active.definition,
          expression: () => alias,
          field: name => {
            if (name !== '@') throw new Error(`Unknown scoped member field "${name}"`)
            return arrayScope.member
          },
        }
        const source = `unnest(${arrayScope.expression}) AS ${alias}`
        if (collectionFilter.operator === Operator.Collection.All) {
          if (collectionFilter.filters.length !== 1) {
            throw new Error('Query $all requires exactly one member predicate')
          }
          const inner = compile(collectionFilter.filters[0] as Filter, memberScope)
          arrayScope.consume?.(1)
          return `NOT EXISTS (SELECT 1 FROM ${source} WHERE NOT COALESCE((${inner}), FALSE))`
        }
        const requirements = collectionFilter.filters.map(requirement => {
          const inner = compile(requirement, memberScope)
          arrayScope.consume?.(1)
          return `EXISTS (SELECT 1 FROM ${source} WHERE ${inner})`
        })
        return requirements.join(' AND ')
      }
      if (!collection) throw new Error(`Unknown collection navigation "${node.field}"`)
      if (collectionFilter.operator === Operator.Comparison.Empty) {
        collection.consume?.(collection.work ?? 1)
        return `NOT EXISTS (SELECT 1 FROM ${collection.relation} WHERE ${collection.condition})`
      }
      if (collectionFilter.operator !== Operator.Comparison.Contains) {
        throw new Error(`Query operator "${collectionFilter.operator}" is not a canonical collection comparison`)
      }
      if (collectionFilter.filters.length === 0) {
        throw new Error(`Query ${Operator.Comparison.Contains} requires at least one member requirement`)
      }
      const requirements = collectionFilter.filters.map(requirement => {
        const inner = compile(requirement, collection)
        collection.consume?.(collection.work ?? 1)
        return `EXISTS (SELECT 1 FROM ${collection.relation} WHERE ` +
          `${collection.condition} AND (${inner}))`
      })
      return requirements.join(' AND ')
    }

    const comparison = comparisonDefinitions.get(node.operator as Operator.Comparison)
    if (comparison) {
      const comparisonFilter = node as ComparisonFilter
      const field = (active.filterField ?? active.field)(comparisonFilter.field)
      const count = active.filterCount?.(comparisonFilter.field)
      if (count && comparisonFilter.operator === Operator.Comparison.Equal && comparisonFilter.value === 0) {
        return count.empty
      }
      if (count && comparisonFilter.operator === Operator.Comparison.GreaterThan && comparisonFilter.value === 0) {
        return count.exists
      }
      if (
        active.filterKind?.(comparisonFilter.field) === 'identity'
        && comparisonFilter.operator !== Operator.Comparison.Equal
      ) {
        throw new Error(
          `Query operator "${comparisonFilter.operator}" is not valid for reference identity ` +
          `"${comparisonFilter.field}"`,
        )
      }
      if (!comparison.allowedFieldTypes.has(field.type)) {
        throw new Error(
          `Query operator "${comparisonFilter.operator}" is not valid for field "${entity.name}.${field.name}"`,
        )
      }
      const operand = comparison.validateOperand(field, comparisonFilter.operator, comparisonFilter.value)
      return comparison.build(field, active.expression(field), operand, bind)
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
    return logical.build(logicalFilter.filters.map(childNode => compile(childNode, active)))
  }

  return { sql: `WHERE ${compile(filter, base)}`, values }
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
    build: (_field, column, operand, bind) => {
      if (operand === null) throw new Error(`Query operator "${operator}" requires a non-null value`)
      return `COALESCE(${column} ${operator} ${bind(operand as BoundScalar)}, FALSE)`
    },
    validateOperand: (field, compare, raw) => Predicate.operand(field, compare, raw),
  }
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
    const field = scope ? (scope.orderField ?? scope.field)(name) : scalarField(entity, name)
    if (field.type === FieldType.Array || field.type === FieldType.JSON) {
      throw new Error(`Query field "${entity.name}.${name}" cannot be used in ordering`)
    }

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
 * Require a predicate-capable field from an entity.
 * @param entity - Entity whose fields are referenced.
 * @param name - Logical field name.
 * @returns The value field definition.
 * @throws {Error} When the field is unknown or is a navigation/reference.
 */
function queryField(entity: EntityDefinition, name: string): QueryFieldDefinition {
  const field = entity.fields.find(candidate => candidate.name === name)
  if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)
  if (field.type === FieldType.Entity) {
    return { name: field.column, type: FieldType.ID }
  }
  if (field.type === FieldType.Inverse) {
    throw new Error(
      `Query field "${entity.name}.${name}" is an inverse navigation; ` +
      'navigation fields cannot be used in predicates or ordering',
    )
  }
  return field
}

/**
 * Resolve the PostgreSQL array type for one array field.
 * @param field - Native array field.
 * @returns Its declared PostgreSQL array type.
 */
function arraySQLType(field: ArrayFieldDefinition): string {
  return `${postgresScalarType(field.items.type)}[]`
}

/**
 * Render one array operand as parameterized PostgreSQL elements.
 * @param field - Native array field.
 * @param operand - Normalized array elements.
 * @param bind - Parameter binder.
 * @returns PostgreSQL array expression.
 */
function arrayExpression(
  field: ArrayFieldDefinition,
  operand: unknown,
  bind: (value: BoundScalar) => string,
): string {
  const values = operand as readonly BoundScalar[]
  if (values.length === 0) return `ARRAY[]::${arraySQLType(field)}`
  const elementType = postgresScalarType(field.items.type)
  return `ARRAY[${values.map(value => `${bind(value)}::${elementType}`).join(', ')}]`
}

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
