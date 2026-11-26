import type { ArrayFieldDefinition, EntityDefinition, EntityDefinitions, EnumFieldDefinition, QueryFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './FieldType'
import { Operator } from './Operator'
import { comparableFieldType } from './PathResolution'
import { postgresScalarType } from './PostgresTypes'
import type { CollectionFilter, ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { ACTOR_FIELD, ACTOR_FIELD_NAME, arrayItemField, ComparisonOperators, isFieldOperand, Predicate } from './Predicate'
import { SortDirection } from './SortDirection'

/** A validated ordering clause. */
export interface SQLOrder {
  /** Quoted `ORDER BY` clause, or an empty string. */
  readonly sql: string,
}

/** A validated parameterized pagination clause. */
export type SQLPagination = SqlFragment

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
  /** Selected root scalar or enum field definitions, in output order. */
  readonly fields: readonly (EnumFieldDefinition | ScalarFieldDefinition)[],
  /** Quoted PostgreSQL `SELECT` clause. */
  readonly sql: string,
}

/** A validated parameterized predicate clause. */
export interface SQLPredicate {
  /** Ordered structural pieces, when built by the compiler. */
  readonly pieces?: readonly SqlPiece[],
  /** Predicate expression without the `WHERE` keyword. */
  readonly predicate?: string,
  /** Quoted PostgreSQL `WHERE` clause, or an empty string. */
  readonly sql: string,
  /** Values for the `$1`, `$2`, … placeholders. */
  readonly values: readonly unknown[],
}

/** Scoped relation used to evaluate one collection comparison. */
export interface CollectionScope {
  /** Nested native-array navigations available to members. */
  readonly array?: (name: string, parent?: QueryScope) => ArrayScope | undefined,
  /** Nested collection navigations available to members. */
  readonly collection?: (name: string, parent?: QueryScope) => CollectionScope | undefined,
  /** Correlated join condition against the root occurrence. */
  readonly condition: string,
  /** Consume finite compiler work for one emitted correlated predicate. */
  readonly consume?: (units?: number) => void,
  /** Related item entity definition. */
  readonly definition: EntityDefinition,
  /** Render one inner field expression. */
  readonly expression: (
    field: QueryFieldDefinition,
    bind?: (value: BoundScalar) => SqlFragment,
  ) => SqlFragment | string,
  /** Resolve one inner field by name. */
  readonly field: (name: string) => QueryFieldDefinition,
  /** Optional count expression metadata for inner count paths. */
  readonly filterCount?: (name: string) => CountScope | undefined,
  /** Classify terminal reference identities inside the collection. */
  readonly filterKind?: (name: string) => 'identity' | undefined,
  /** Authored source predicate applied to the collection relation. */
  readonly predicate?: SqlFragment,
  /** SQL relation containing the related items. */
  readonly relation: string,
  /** Concrete physical variants for descendant-only sibling collections. */
  readonly variants?: readonly CollectionScopeVariant[],
  /** Expanded relation join work emitted by this scope. */
  readonly work?: number,
}

/** One concrete physical variant of a descendant-only collection. */
export interface CollectionScopeVariant {
  /** SQL predicate selecting this variant's concrete owner type. */
  readonly guard: string,
  /** Scope for the variant's physical relation and member fields. */
  readonly scope: CollectionScope,
}

/** One literal SQL text piece or structural parameter slot. */
type SqlPiece = string | { readonly shared?: boolean, readonly value: unknown }

/** One parameterized SQL fragment. */
export interface SqlFragment {
  /** Ordered literal text and parameter slots. */
  readonly pieces: readonly SqlPiece[],
  /** SQL text with positional `$1`, `$2`, … placeholders. */
  readonly sql: string,
  /** Values bound to the placeholders, in order. */
  readonly values: readonly unknown[],
}

/**
 * Render ordered pieces once into inspectable SQL and ordered values.
 * @param pieces - Ordered literal and parameter pieces.
 * @returns Inspectable SQL and ordered values.
 */
function compilePieces(pieces: readonly SqlPiece[]): { sql: string, values: readonly unknown[] } {
  const values: unknown[] = []
  const sharedIndexes = new Map<object, number>()
  let sql = ''
  for (const piece of pieces) {
    if (typeof piece === 'string') {
      sql += piece
      continue
    }
    const shared = piece.shared === true
    let index = shared ? sharedIndexes.get(piece) : undefined
    if (index === undefined) {
      values.push(piece.value)
      index = values.length
      if (shared) sharedIndexes.set(piece, index)
    }
    sql += `$${index}`
  }
  return { sql, values }
}

/**
 * Build a fragment from ordered pieces.
 * @param pieces - Ordered literal and parameter pieces.
 * @returns One ordered SQL fragment.
 */
function fragmentOf(pieces: readonly SqlPiece[]): SqlFragment {
  const compiled = compilePieces(pieces)
  const fragment = { sql: compiled.sql, values: compiled.values }
  Object.defineProperty(fragment, 'pieces', { enumerable: false, value: pieces })
  return fragment as SqlFragment
}

/**
 * Literal SQL text.
 * @param text - Literal SQL text.
 * @returns One literal fragment.
 */
export function sqlText(text: string): SqlFragment {
  return fragmentOf([text])
}

/**
 * One bound value slot.
 * @param value - Bound value.
 * @returns One parameter fragment.
 */
export function sqlValue(value: unknown): SqlFragment {
  return fragmentOf([{ value }])
}

/**
 * One reusable bound value slot.
 *
 * Reusing the returned fragment in more than one SQL location keeps one
 * placeholder and one ordered value, so related predicates cannot drift.
 * @param value - Bound value.
 * @returns One shared parameter fragment.
 */
export function sqlParameter(value: unknown): SqlFragment {
  return fragmentOf([{ shared: true, value }])
}

/**
 * Whether a value is an ordered SQL fragment.
 * @param value - Candidate value.
 * @returns Whether the value is a fragment.
 */
function isSqlFragment(value: unknown): value is SqlFragment {
  return typeof value === 'object' && value !== null && 'pieces' in value
}

/**
 * Build one fragment from template text and nested values.
 * @param strings - Template literal text.
 * @param values - Interpolated values and nested fragments.
 * @returns One ordered SQL fragment.
 */
export function sqlFragment(strings: TemplateStringsArray, ...values: readonly unknown[]): SqlFragment {
  const pieces: SqlPiece[] = []
  strings.forEach((text, index) => {
    pieces.push(text)
    if (index >= values.length) return
    const value = values[index]
    if (isSqlFragment(value)) pieces.push(...value.pieces)
    else pieces.push({ value })
  })
  return fragmentOf(pieces)
}

/**
 * Concatenate fragments and literal strings in order.
 * @param fragments - Ordered fragments and literals.
 * @param separator - Text between non-empty fragments.
 * @returns One ordered SQL fragment.
 */
export function sqlConcat(
  fragments: readonly (SqlFragment | string | undefined)[],
  separator = ' ',
): SqlFragment {
  const pieces: SqlPiece[] = []
  let wrote = false
  for (const value of fragments) {
    if (value === undefined) continue
    if (typeof value === 'string') {
      if (value === '') continue
      if (wrote && separator !== '') pieces.push(separator)
      pieces.push(value)
      wrote = true
      continue
    }
    if (value.pieces === undefined) throw new Error(`SQL fragment missing pieces: ${JSON.stringify(value)}`)
    if (value.pieces.length === 0) continue
    if (wrote && separator !== '') pieces.push(separator)
    pieces.push(...value.pieces)
    wrote = true
  }
  return fragmentOf(pieces)
}

/** Render a count form through the caller's value binder. */
export type CountRenderer = (bind: (value: BoundScalar) => SqlFragment) => SqlFragment | string

/** Count expression forms used to canonicalize collection counts. */
export interface CountScope {
  /** Zero-count predicate. */
  readonly empty: string | CountRenderer,
  /** Non-zero existence predicate. */
  readonly exists: string | CountRenderer,
  /** Numeric count expression. */
  readonly expression: string,
  /** Composable count query, when the expression needs bound values. */
  readonly fragment?: SqlFragment,
  /** Bind the numeric count expression into the caller's value list. */
  readonly render?: CountRenderer,
}

/** Scoped native-array relation used to evaluate one member predicate. */
export interface ArrayScope {
  /** Consume finite compiler work for one emitted member predicate. */
  readonly consume?: (units?: number) => void,
  /** SQL array expression to unnest. */
  readonly expression: SqlFragment | string,
  /** Native array field metadata. */
  readonly field: ArrayFieldDefinition,
  /** Scalar element metadata. */
  readonly member: ScalarFieldDefinition,
}

/** Optional effective-field scope for polymorphic entity queries. */
export interface QueryScope {
  /** Resolve a native array navigation for member-predicate compilation. */
  readonly array?: (name: string, parent?: QueryScope) => ArrayScope | undefined,
  /** Resolve a collection navigation for collection comparison compilation. */
  readonly collection?: (name: string, parent?: QueryScope) => CollectionScope | undefined,
  /** Effective entity metadata used for validation. */
  readonly definition: EntityDefinition,
  /** Render a field expression with physical table qualification. */
  readonly expression: (
    field: QueryFieldDefinition,
    bind?: (value: BoundScalar) => SqlFragment,
  ) => SqlFragment | string,
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
export type BoundScalar = string | number | boolean | bigint | Date

/** The verified actor identity expression; `NULL` for anonymous requests. */
const ACTOR_SQL = 'nullif(current_setting(\'actor.id\', true), \'\')'

/** The physical SQL renderer for one comparison operator. */
interface ComparisonRenderer {
  /** Build the SQL fragment and bind its value. */
  readonly build: (
    field: QueryFieldDefinition,
    column: SqlFragment,
    operand: unknown,
    bind: (value: BoundScalar) => SqlFragment,
  ) => SqlFragment,
}

/** A per-logical-operator definition used by the closed operator registry. */
interface LogicalDefinition {
  /** Build a parenthesized logical group. */
  readonly build: (children: readonly SqlFragment[]) => SqlFragment,
  /** Maximum number of child predicates, when fixed. */
  readonly maximumOperands?: number,
  /** Minimum number of child predicates. */
  readonly minimumOperands: number,
}

/** The complete comparison renderer registry. */
const comparisonRenderers = new Map<Operator.Comparison, ComparisonRenderer>([
  [Operator.Comparison.Equal, {
    build: (field, column, operand, bind) => {
      if (field.type === FieldType.Array) {
        if (operand === null) return sqlFragment`${column} IS NULL`
        const rhs = arrayExpression(field, operand, bind)
        return sqlFragment`(${column} IS NOT NULL AND ${column} @> ${rhs} AND ${column} <@ ${rhs})`
      }
      if (operand === null) return sqlFragment`${column} IS NULL`
      return sqlFragment`${column} IS NOT DISTINCT FROM ${bind(operand as BoundScalar)}`
    },
  }],
  [Operator.Comparison.SequenceEqual, {
    build: (field, column, operand, bind) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.SequenceEqual}" requires an array field`)
      }
      return sqlFragment`${column} IS NOT DISTINCT FROM ${arrayExpression(field, operand, bind)}`
    },
  }],
  [Operator.Comparison.Contains, {
    build: (field, column, operand, bind) => {
      if (field.type === FieldType.Array) {
        return sqlFragment`${column} @> ${arrayExpression(field, operand, bind)}`
      }
      if (field.type === FieldType.JSON) {
        return sqlFragment`${column} @> ${bind(JSON.stringify(operand))}::text::jsonb`
      }
      const value = operand as string
      const pattern = `%${value.replace(/[\\%_]/gu, '\\$&')}%`
      return sqlFragment`(${column} IS NOT NULL AND ${column} ILIKE ${bind(pattern)} ESCAPE '\\')`
    },
  }],
  [Operator.Comparison.In, {
    build: (_field, column, operand, bind) => {
      const values = operand as readonly BoundScalar[]
      if (values.length === 0) {
        throw new Error(`Query operator "${Operator.Comparison.In}" requires a non-empty value list`)
      }
      return sqlFragment`${column} IN (${sqlConcat(values.map(value => bind(value)), ', ')})`
    },
  }],
  [Operator.Comparison.Overlaps, {
    build: (field, column, operand, bind) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.Overlaps}" requires an array field`)
      }
      return sqlFragment`${column} && ${arrayExpression(field, operand, bind)}`
    },
  }],
  [Operator.Comparison.Empty, {
    build: (field, column) => {
      if (field.type !== FieldType.Array) {
        throw new Error(`Query operator "${Operator.Comparison.Empty}" requires an array field`)
      }
      return sqlFragment`COALESCE(cardinality(${column}), 0) = 0`
    },
  }],
  [Operator.Comparison.GreaterThan, rangeRenderer('>')],
  [Operator.Comparison.GreaterThanOrEqual, rangeRenderer('>=')],
  [Operator.Comparison.LessThan, rangeRenderer('<')],
  [Operator.Comparison.LessThanOrEqual, rangeRenderer('<=')],
])

/** The complete logical operator registry. */
const logicalDefinitions = new Map<Operator.Logical, LogicalDefinition>([
  [Operator.Logical.And, {
    build: children => sqlFragment`(${sqlConcat(children, ' AND ')})`,
    minimumOperands: 1,
  }],
  [Operator.Logical.Not, {
    build: children => sqlFragment`(NOT COALESCE((${children[0] ?? sqlText('')}), FALSE))`,
    maximumOperands: 1,
    minimumOperands: 1,
  }],
  [Operator.Logical.Or, {
    build: children => sqlFragment`(${sqlConcat(children, ' OR ')})`,
    minimumOperands: 1,
  }],
])

/**
 * Normalize and build parameterized root-field comparison predicates.
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
  if (!filter) return predicateResult('', [], '')
  return whereFilter(entities, entityName, filter, scope)
}

/**
 * Build one predicate result with a non-enumerable bare expression.
 * @param sql - Complete `WHERE` clause.
 * @param values - Bound values.
 * @param predicate - Expression without `WHERE`.
 * @param fragment - Optional structural predicate fragment.
 * @returns Predicate result.
 */
function predicateResult(
  sql: string,
  values: readonly BoundScalar[],
  predicate: string,
  fragment?: SqlFragment,
): SQLPredicate {
  const result = { sql, values }
  Object.defineProperty(result, 'predicate', { enumerable: false, value: predicate })
  if (fragment !== undefined) {
    Object.defineProperty(result, 'pieces', { enumerable: false, value: fragment.pieces })
  }
  return result as SQLPredicate
}

/**
 * Build parameterized predicates from one already-normalized filter.
 * @param entities - Validated entity definitions.
 * @param entityName - Exact entity name.
 * @param filter - Canonical normalized filter.
 * @param scope - Optional effective-field expressions for polymorphic queries.
 * @param literal - Optional renderer for literal policy SQL.
 * @returns The quoted `WHERE` clause and its parameter values.
 * @throws {Error} When a field, operator, or value is invalid.
 */
function whereFilter(
  entities: EntityDefinitions,
  entityName: string,
  filter: Filter,
  scope?: QueryScope,
  literal?: (value: BoundScalar) => string,
): SQLPredicate {
  const entity = scope?.definition ?? definition(entities, entityName)
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

  const bind = (value: BoundScalar): SqlFragment => {
    if (value === ACTOR_FIELD_NAME) return sqlText(ACTOR_SQL)
    if (literal !== undefined) return sqlText(literal(value))
    return sqlValue(value)
  }
  const asFragment = (value: SqlFragment | string): SqlFragment => (
    typeof value === 'string' ? sqlText(value) : value
  )
  const literalFragment = (fragment: SqlFragment): SqlFragment => {
    if (literal === undefined) return fragment
    const pieces = fragment.pieces ?? []
    return fragmentOf(pieces.map(piece => (
      typeof piece === 'string' ? piece : literal(piece.value as BoundScalar)
    )))
  }

  const base: QueryScope = scope ?? {
    array,
    definition: entity,
    expression: field => quoteIdentifier(field.name),
    field: name => queryField(entity, name),
  }
  let arrayAlias = 0
  const compile = (node: Filter, active: QueryScope): SqlFragment => {
    if ('field' in node && 'filters' in node) {
      const collection = active.collection?.(node.field, active)
      const arrayScope = active.array?.(node.field, active)
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
          return sqlFragment`NOT EXISTS (SELECT 1 FROM ${sqlText(source)} WHERE NOT COALESCE((${inner}), FALSE))`
        }
        const requirements = collectionFilter.filters.map(requirement => {
          const inner = compile(requirement, memberScope)
          arrayScope.consume?.(1)
          return sqlFragment`EXISTS (SELECT 1 FROM ${sqlText(source)} WHERE ${inner})`
        })
        return sqlConcat(requirements, ' AND ')
      }
      if (!collection) throw new Error(`Unknown collection navigation "${node.field}"`)
      if (collection.variants !== undefined && collection.variants.length > 0) {
        return sqlFragment`(${sqlConcat(collection.variants.map(variant => (
          sqlFragment`(${sqlText(variant.guard)} AND ${compileCollection(collectionFilter, variant.scope)})`
        )), ' OR ')})`
      }
      return compileCollection(collectionFilter, collection)
    }

    const contract = ComparisonOperators.definition(node.operator as Operator.Comparison)
    if (contract) {
      const comparisonFilter = node as ComparisonFilter
      const field = comparisonFilter.field === ACTOR_FIELD_NAME
        ? ACTOR_FIELD
        : (active.filterField ?? active.field)(comparisonFilter.field)
      const count = active.filterCount?.(comparisonFilter.field)
      if (count && comparisonFilter.operator === Operator.Comparison.Equal && comparisonFilter.value === 0) {
        return typeof count.empty === 'function' ? asFragment(count.empty(bind)) : asFragment(count.empty)
      }
      if (count && comparisonFilter.operator === Operator.Comparison.GreaterThan && comparisonFilter.value === 0) {
        return typeof count.exists === 'function' ? asFragment(count.exists(bind)) : asFragment(count.exists)
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
      if (!contract.allowedFieldTypes.has(field.type)) {
        throw new Error(
          `Query operator "${comparisonFilter.operator}" is not valid for field "${field.name}"`,
        )
      }
      const operand = contract.operand(field, comparisonFilter.value)
      const renderer = comparisonRenderers.get(comparisonFilter.operator)
      if (!renderer) throw new Error(`Query operator "${comparisonFilter.operator}" is not supported`)
      const column = field.name === ACTOR_FIELD_NAME ? sqlText(ACTOR_SQL) : asFragment(active.expression(field, bind))
      if (comparisonFilter.operator === Operator.Comparison.Contains
        && field.type === FieldType.Array
        && isFieldOperand(operand)) {
        const reference = (active.filterField ?? active.field)(operand.$field)
        if (comparableFieldType(reference.type) !== comparableFieldType(arrayItemField(field).type)) {
          throw new Error(
            `Query field reference "${operand.$field}" is not comparable with "${comparisonFilter.field}"`,
          )
        }
        const referenceSql = reference.name === ACTOR_FIELD_NAME
          ? sqlText(ACTOR_SQL)
          : asFragment(active.expression(reference, bind))
        return renderer.build(field, column, [referenceSql], () => referenceSql)
      }
      if (isFieldOperand(operand)) {
        if (ACTOR_FIELD_NAME === operand.$field) {
          throw new Error('Query field references cannot target the actor sentinel')
        }
        const reference = (active.filterField ?? active.field)(operand.$field)
        if (comparableFieldType(reference.type) !== comparableFieldType(field.type)) {
          throw new Error(
            `Query field reference "${operand.$field}" is not comparable with "${comparisonFilter.field}"`,
          )
        }
        const referenceSql = reference.name === ACTOR_FIELD_NAME
          ? sqlText(ACTOR_SQL)
          : asFragment(active.expression(reference, bind))
        return renderer.build(field, column, operand, () => referenceSql)
      }
      return renderer.build(field, column, operand, bind)
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

  const compileCollection = (
    collectionFilter: CollectionFilter,
    collection: CollectionScope,
  ): SqlFragment => {
    if (collectionFilter.operator === Operator.Comparison.Empty) {
      const authored = collection.predicate === undefined
        ? sqlText('')
        : sqlFragment` AND (${literalFragment(asFragment(collection.predicate))})`
      collection.consume?.(collection.work ?? 1)
      const relation = sqlText(collection.relation)
      const condition = sqlText(collection.condition)
      return sqlFragment`NOT EXISTS (SELECT 1 FROM ${relation} WHERE ${condition}${authored})`
    }
    if (collectionFilter.operator === Operator.Collection.All) {
      if (collectionFilter.filters.length !== 1) {
        throw new Error('Query $all requires exactly one member predicate')
      }
      const inner = compile(collectionFilter.filters[0] as Filter, collection)
      collection.consume?.(collection.work ?? 1)
      const predicate = collection.predicate === undefined
        ? sqlText('')
        : sqlFragment` AND (${literalFragment(asFragment(collection.predicate))})`
      const relation = sqlText(collection.relation)
      const condition = sqlText(collection.condition)
      const body = sqlFragment`${condition}${predicate} AND NOT COALESCE((${inner}), FALSE)`
      return sqlFragment`NOT EXISTS (SELECT 1 FROM ${relation} WHERE ${body})`
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
      const predicate = collection.predicate === undefined
        ? sqlText('')
        : sqlFragment` AND (${literalFragment(asFragment(collection.predicate))})`
      const relation = sqlText(collection.relation)
      const condition = sqlText(collection.condition)
      const body = sqlFragment`${condition}${predicate} AND (${inner})`
      return sqlFragment`EXISTS (SELECT 1 FROM ${relation} WHERE ${body})`
    })
    return sqlConcat(requirements, ' AND ')
  }

  const predicate = compile(filter, base)
  return predicateResult(`WHERE ${predicate.sql}`, predicate.values as BoundScalar[], predicate.sql, predicate)
}

/**
 * Create a parameterized range-comparison renderer.
 * @param operator - SQL comparison operator.
 * @returns The comparison renderer.
 */
function rangeRenderer(operator: string): ComparisonRenderer {
  return {
    build: (_field, column, operand, bind) => {
      if (operand === null) throw new Error(`Query operator "${operator}" requires a non-null value`)
      return sqlFragment`COALESCE(${column} ${sqlText(operator)} ${bind(operand as BoundScalar)}, FALSE)`
    },
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
    const shorthand = typeof entry === 'string' && entry.startsWith('-')
    const name = typeof entry === 'string'
      ? shorthand ? entry.slice(1) : entry
      : entry.field
    if (typeof entry === 'string' && shorthand && name === '') {
      throw new Error('Query orderBy shorthand must name a field after "-"')
    }
    if (typeof entry === 'string' && entry.startsWith('--')) {
      throw new Error('Query orderBy shorthand must use one leading "-"')
    }
    const direction = typeof entry === 'string'
      ? shorthand ? SortDirection.Descending : SortDirection.Ascending
      : entry.direction ?? SortDirection.Ascending
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
 * @returns The pagination fragment and its ordered values.
 * @throws {Error} When limit or offset is not a non-negative integer.
 */
function paginate(
  limit: number | null = 25,
  offset = 0,
): SQLPagination {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('Query limit must be a non-negative integer or null')
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('Query offset must be a non-negative integer')
  }

  const clauses: SqlFragment[] = []
  if (limit !== null) clauses.push(sqlFragment`LIMIT ${sqlValue(limit)}`)
  if (limit !== null || offset > 0) clauses.push(sqlFragment`OFFSET ${sqlValue(offset)}`)
  return sqlConcat(clauses, ' ')
}

/**
 * Internal construction of model-aware SQL. Bun owns execution; this owner
 * builds only projection, predicate, ordering, and pagination syntax from
 * validated entity metadata.
 */
export const SQL = {
  concat: sqlConcat,
  orderBy: orderByClause,
  paginate,
  select,
  where: whereClause,
  whereFilter,
}

/**
 * Require a predicate-capable field from an entity.
 * @param entity - Entity whose fields are referenced.
 * @param name - Logical field name.
 * @returns The value field definition.
 * @throws {Error} When the field is unknown or is a navigation/reference.
 */
function queryField(entity: EntityDefinition, name: string): QueryFieldDefinition {
  return Predicate.field(entity, name)
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
  bind: (value: BoundScalar) => SqlFragment,
): SqlFragment {
  const values = operand as readonly BoundScalar[]
  if (values.length === 0) return sqlText(`ARRAY[]::${arraySQLType(field)}`)
  const elementType = postgresScalarType(field.items.type)
  return sqlFragment`ARRAY[${sqlConcat(values.map(value => (
    sqlFragment`${bind(value)}::${sqlText(elementType)}`
  )), ', ')}]`
}

/**
 * Require a selectable scalar field from an entity.
 * @param entity - Entity whose fields are referenced.
 * @param name - Logical field name.
 * @returns The scalar field definition.
 * @throws {Error} When the field is unknown or is an entity reference.
 */
function scalarField(entity: EntityDefinition, name: string): EnumFieldDefinition | ScalarFieldDefinition {
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
  if (field.type === FieldType.Collection) {
    throw new Error(
      `Query field "${entity.name}.${name}" is a collection; ` +
      'collection fields cannot be used in predicates or ordering',
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
