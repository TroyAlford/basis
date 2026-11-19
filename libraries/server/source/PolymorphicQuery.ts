import { resolveCollectionRelation } from './CollectionRelation'
import { collectionSqlRelation } from './CollectionSql'
import type { AssociationDefinition, DerivedCollectionDefinition, DerivedSingularDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, QueryFieldDefinition, RelationshipDefinition, RelationshipEndpointDefinition } from './EntityDefinitions'
import { Constraint, FieldType, identityDefinition } from './EntityDefinitions'
import type { DescendantField } from './PathResolution'
import { abstractEntityView, descendantFields, resolveCollectionPath, resolveFieldPath, universalDescendantFields } from './PathResolution'
import { parseCollectionDirectives, splitFieldPath } from './PathSyntax'
import type { Filter } from './Predicate'
import { arrayItemField } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { ArrayScope, BoundScalar, CollectionScope, CountScope, OrderBy, QueryScope, SqlFragment, SQLPredicate } from './SQL'
import { SQL } from './SQL'

/** Maximum number of singular reference hops in one requested path. */
const MAX_REFERENCE_DEPTH = 8
/** Maximum number of requested projection paths in one query. */
const MAX_PROJECTION_PATHS = 64
/** Maximum total path segments and selected collections in one query. */
const MAX_PROJECTION_WORK = 128

/** Internal projection work limits for one query compilation. */
export interface ProjectionBudget {
  /** Maximum requested projection paths. */
  readonly paths: number,
  /** Maximum expanded graph work. */
  readonly work: number,
}

/** The public query projection budget. */
const PUBLIC_PROJECTION_BUDGET: ProjectionBudget = {
  paths: MAX_PROJECTION_PATHS,
  work: MAX_PROJECTION_WORK,
}

/** Options accepted by a polymorphic entity query. */
export interface PolymorphicQueryOptions {
  /** Internal unique alias prefix for correlated projected collections. */
  readonly aliasPrefix?: string,
  /** Effective scalar, scalar-array, JSON, collection, or singular-reference paths to project. */
  readonly fields: readonly string[],
  /** Maximum rows to return; defaults to 25, or `null` for unlimited. */
  readonly limit?: number | null,
  /** Rows to skip; defaults to 0. */
  readonly offset?: number,
  /** Explicit effective-field ordering, single or multi-level. */
  readonly orderBy?: OrderBy,
  /** Internal full-record projection budget; public queries use the standard budget. */
  readonly projectionBudget?: ProjectionBudget,
  /** Internal raw root condition used to correlate a projected collection. */
  readonly rawWhere?: SqlFragment,
  /** Internal root alias used by correlated projected collections. */
  readonly rootAlias?: string,
  /** Effective-field predicate. */
  readonly where?: Filter | Readonly<Record<string, unknown>> | string,
}

/** A compiled polymorphic query and its row hydrator. */
export interface CompiledPolymorphicQuery {
  /** Convert one flat SQL row into the requested nested projection. */
  readonly hydrate: (row: Record<string, unknown>) => Record<string, unknown>,
  /** Complete SQL statement. */
  readonly sql: string,
  /** Values bound to `$1`, `$2`, … in order. */
  readonly values: readonly unknown[],
}

/** One selected scalar column. */
interface ScalarProjection {
  /** SQL column alias. */
  readonly alias: string,
  /** Output field name. */
  readonly name: string,
}

/** The default universal identity selected for one reference target. */
interface IdentityProjection {
  /** SQL column alias for the target ID. */
  readonly entity: string,
  /** SQL column alias for the target discriminator. */
  readonly id: string,
  /** SQL column alias for the target name. */
  readonly name: string,
}

/** One projected collection compiled as a correlated child query. */
interface ProjectedCollectionProjection {
  /** SQL column alias carrying the JSON item array. */
  readonly alias: string,
  /** Convert the JSON items into the `{ items, $matched, $total }` envelope. */
  readonly hydrate: (row: Record<string, unknown>) => {
    $matched: number,
    $total: number,
    items: unknown[],
  },
  /** SQL column alias carrying the filtered count. */
  readonly matchedAlias: string,
  /** Output field name. */
  readonly name: string,
  /** SQL column alias carrying the unfiltered count. */
  readonly totalAlias: string,
}

/** Requested paths below one collection navigation. */
interface ProjectedCollectionSpec {
  /** Collection navigation metadata. */
  readonly collection: DerivedCollectionDefinition,
  /** Whether this collection already received a directive path. */
  directivesSeen: boolean,
  /** Relationship-owned scalar fields requested on the item. */
  readonly edgeFields: Set<string>,
  /** Relative target fields requested below the collection. */
  readonly fields: Set<string>,
  /** Collection-context filters. */
  readonly filters: Set<string>,
  /** Requested page size; `null` means unlimited. */
  limit?: number | null,
  /** Requested page offset. */
  offset?: number,
  /** Requested item ordering. */
  orderBy?: OrderBy,
}

/** One nested singular reference. */
interface ReferenceProjection {
  /** Canonical association for each target node. */
  readonly associations: readonly (AssociationDefinition | undefined)[],
  /** Output reference field name. */
  readonly name: string,
  /** Variant target nodes; a normal reference has exactly one. */
  readonly nodes: readonly ProjectionNode[],
}

/** Path-local navigation state used for reciprocal backtracking checks. */
interface TraversalState {
  /** Reciprocal association entered by the previous step. */
  readonly association?: AssociationDefinition,
  /** Direction of the previous step. */
  readonly direction: 'forward' | 'inverse',
}

/** One entity occurrence in a projection tree. */
interface ProjectionNode {
  /** Effective-field and descendant metadata for this occurrence. */
  readonly context: EntityContext,
  /** Field names already selected at this node. */
  readonly fieldNames: Set<string>,
  /** Non-identity scalar fields selected at this node. */
  readonly fields: ScalarProjection[],
  /** Whether identity fields have been selected for a reference node. */
  identity?: IdentityProjection,
  /** Reference path from the query root. */
  readonly path: readonly string[],
  /** Projected collection output descriptors. */
  readonly projectedCollections: ProjectedCollectionProjection[],
  /** Projected collection specifications by collection name. */
  readonly projectedSpecs: Map<string, ProjectedCollectionSpec>,
  /** Singular references by name. */
  readonly referenceNames: Map<string, ReferenceProjection>,
  /** Singular references selected at this node. */
  readonly references: ReferenceProjection[],
}

/** Local join sink used by root filters or a correlated collection scope. */
interface FilterJoinScope {
  /** Allocate a unique SQL alias. */
  alias(prefix: string): string,
  /** Reference-target contexts shared within this sink. */
  readonly cache: Map<string, EntityContext>,
  /** Consume finite compiler work. */
  consume(units?: number): void,
  /** Append one SQL join to the active relation. */
  join(sql: string): void,
}

/** Effective-field metadata for one entity occurrence. */
interface EntityContext {
  /** Base table holding the entity row. */
  readonly baseAlias: string,
  /** Derived collection navigations exposed by this occurrence. */
  readonly collections: ReadonlyMap<string, DerivedCollectionDefinition>,
  /** Entity definition for this occurrence. */
  readonly definition: EntityDefinition,
  /** Descendant-only fields keyed by logical name. */
  readonly descendants: ReadonlyMap<string, DescendantField>,
  /** Effective fields keyed by logical name. */
  readonly effective: ReadonlyMap<string, EffectiveFieldDefinition>,
  /** Whether this occurrence is a reference target rather than the root. */
  readonly isTarget: boolean,
  /** Field-owner aliases already joined for this occurrence. */
  readonly ownerAliases: Map<string, string>,
  /** Universal identity root alias. */
  readonly rootAlias: string,
  /** Whether the root table alias has already been joined. */
  rootJoined: boolean,
  /** Whether this occurrence is the universal `Entity` root itself. */
  readonly rootOnly: boolean,
  /** Effective singular inverse navigations exposed by this occurrence. */
  readonly singularNavigations: ReadonlyMap<string, DerivedSingularDefinition>,
}

/** One reusable collection relation and its correlated condition. */
interface CollectionRelationPlan {
  /** Collection navigation being planned. */
  readonly collection: DerivedCollectionDefinition,
  /** Correlated condition against the owning occurrence, including authored predicates. */
  readonly condition: string,
  /** Alias of the owning occurrence. */
  readonly parentAlias: string,
  /** Authored source predicate, when the collection declares one. */
  readonly predicate?: SQLPredicate,
  /** Base SQL relation containing target rows. */
  readonly relation: string,
  /** Named relationship providing source rows, when relationship-backed. */
  readonly relationship?: RelationshipDefinition,
  /** Relationship table alias for relationship-owned fields. */
  readonly relationshipAlias?: string,
  /** Whether the result is an entity or a relationship record. */
  readonly resultType: 'entity' | 'record',
  /** Target universal-root alias, when the result is an entity. */
  readonly rootAlias?: string,
  /** Projection target: an entity, or the relationship record view. */
  readonly target: EntityDefinition,
  /** Physical target table alias, absent for the universal root. */
  readonly targetAlias?: string,
  /** Relationship endpoint identifying the projected target. */
  readonly targetEndpoint?: RelationshipEndpointDefinition,
  /** Initial relation work emitted by this plan. */
  readonly work: number,
}

/** One physical member query for a collection projection. */
interface CollectionMemberQuery extends SqlFragment {
  /** Hydrate one selected member row. */
  readonly hydrate: (row: Record<string, unknown>) => Record<string, unknown>,
}

/** One physical adapter for collection member rows. */
interface CollectionMemberAdapter {
  /** Compile one member query, optionally filtered. */
  readonly compile: (filter?: string) => CollectionMemberQuery,
  /** Output aliases forming the result identity. */
  readonly identity: readonly string[],
  /** Whether member rows are already unique by identity. */
  readonly identityUnique: boolean,
  /** Output aliases available for ordering. */
  readonly orderable: ReadonlySet<string>,
}

/**
 * Build one entity-scoped projection tree and its SQL relation set.
 *
 * The compiler reuses canonical effective-field ownership, while adding
 * nullable descendant projections and singular reference joins. It never
 * performs per-row lookups; hydration only reshapes the single returned row.
 */
class QueryProjection {
  /** Selected SQL column expressions. */
  readonly columns: string[] = []
  /** Additional joins required by the projection. */
  readonly joins: string[] = []
  /** Root query occurrence. */
  readonly root: EntityContext
  /** Canonical entity definitions. */
  readonly #entities: EntityDefinitions
  /** Next generated table alias number. */
  #alias = 0
  /** Filter-only expression overrides keyed by logical path. */
  readonly #filterExpressions = new Map<string, string>()
  /** Predicate-only renderers that bind filtered collection count values. */
  readonly #filterRenders = new Map<string, (bind: (value: BoundScalar) => string) => string>()
  /** Filter-only resolved fields keyed by logical path. */
  readonly #filterFields = new Map<string, QueryFieldDefinition>()
  /** Reusable collection relation plans keyed by logical collection path. */
  readonly #collectionPlans = new Map<string, CollectionRelationPlan>()
  /** Collection predicate scopes keyed by root navigation name. */
  readonly #collectionScopes = new Map<string, CollectionScope>()
  /** Count expressions and existence forms keyed by logical count path. */
  readonly #countFields = new Map<string, CountScope>()
  /** Count CTE definitions keyed by physical count path. */
  readonly #countScopes = new Map<string, CountScope>()
  /** Stable filter/projection reference contexts keyed by logical path. */
  readonly #filterContexts = new Map<string, EntityContext>()
  /** Filter paths that resolve to reference identities. */
  readonly #filterIdentities = new Set<string>()
  /** Graph work consumed while expanding the projection. */
  #work = 0
  /** Projection limits for this compilation. */
  readonly #budget: ProjectionBudget
  /** Values bound by collection subqueries. */
  readonly values: unknown[] = []
  /** Starting placeholder index for collection values. */
  #valueStart = 1
  /** Prefix that keeps nested compiler aliases unique. */
  readonly #aliasPrefix: string

  /**
   * Create the root occurrence for one query.
   * @param entities - Canonical definitions.
   * @param definition - Root entity being queried.
   * @param budget - Projection limits; defaults to the public query budget.
   * @param rootAlias - Root table alias for this query.
   * @param aliasPrefix - Prefix for nested compiler aliases.
   */
  constructor(
    entities: EntityDefinitions,
    definition: EntityDefinition,
    budget: ProjectionBudget = PUBLIC_PROJECTION_BUDGET,
    rootAlias = 't',
    aliasPrefix = '',
  ) {
    this.#entities = entities
    this.#budget = budget
    this.#aliasPrefix = aliasPrefix
    this.root = {
      baseAlias: rootAlias,
      collections: contextCollections(entities, definition),
      definition,
      descendants: descendantFields(entities, definition),
      effective: new Map(definition.effectiveFields.map(field => [field.name, field])),
      isTarget: false,
      ownerAliases: new Map([[definition.name, rootAlias]]),
      rootAlias: 'r',
      rootJoined: false,
      rootOnly: false,
      singularNavigations: new Map(
        definition.singularNavigations.map(navigation => [navigation.name, navigation]),
      ),
    }
  }

  /**
   * Build the requested projection paths.
   * @param fields - Effective scalar names or dotted singular-reference paths.
   * @param valueStart - First placeholder index available to collection queries.
   * @returns A row hydrator for the requested nested shape.
   * @throws {Error} When a path is invalid or an expansion is not supported.
   */
  build(
    fields: readonly string[],
    valueStart: number,
  ): (row: Record<string, unknown>) => Record<string, unknown> {
    if (fields.length === 0) throw new Error('Query fields must be a non-empty array')
    this.#validateBudget(fields)
    this.#valueStart = valueStart
    const root = this.#node(this.root, [])
    for (const field of fields) this.#addPath(root, splitFieldPath(field), undefined, 0)
    const nodes: ProjectionNode[] = [root]
    for (const node of nodes) {
      for (const reference of node.references) nodes.push(...reference.nodes)
    }
    for (const node of nodes) {
      for (const spec of node.projectedSpecs.values()) this.#addProjectedCollection(node, spec)
    }
    return row => hydrateRoot(row, root)
  }

  /**
   * Validate path count and total graph work before compiling SQL.
   * @param fields - Requested field paths.
   */
  #validateBudget(fields: readonly string[]): void {
    if (fields.length > this.#budget.paths) {
      throw new Error(
        `Query projection exceeds the maximum path count of ${this.#budget.paths}`,
      )
    }
    const work = fields.reduce((total, field) => total + splitFieldPath(field).length, 0)
    if (work > this.#budget.work) {
      throw new Error(
        `Query projection exceeds the maximum graph work budget of ${this.#budget.work}`,
      )
    }
  }

  /**
   * Build the root filter join sink.
   * @returns A sink backed by the outer projection joins.
   */
  #outerFilterScope(): FilterJoinScope {
    return {
      alias: prefix => this.#nextAlias(prefix),
      cache: this.#filterContexts,
      consume: units => this.#consume(units),
      join: sql => this.joins.push(sql),
    }
  }

  /**
   * Ensure the root table is joined for the root occurrence.
   * @returns The root alias.
   */
  ensureRoot(): string {
    return this.#ensureRoot(this.root)
  }

  /**
   * Render one root effective scalar field for predicates and ordering.
   * @param field - Effective scalar field.
   * @param bind - Optional predicate value binder for filtered counts.
   * @returns Physical SQL expression.
   */
  expression(field: QueryFieldDefinition, bind?: (value: BoundScalar) => string): string {
    const render = this.#filterRenders.get(field.name)
    if (render) {
      if (!bind) throw new Error(`Collection $matched field "${field.name}" is only valid in a predicate`)
      return render(bind)
    }
    const count = this.#countFields.get(field.name)
    if (count) {
      if (bind !== undefined && count.render !== undefined) return count.render(bind)
      if (count.expression === '') {
        throw new Error(`Collection count field "${field.name}" requires a value binder`)
      }
      return count.expression
    }
    const filtered = this.#filterExpressions.get(field.name)
    if (filtered) return filtered
    const effective = this.root.effective.get(field.name)
    if (!effective) throw new Error(`Unknown field "${this.root.definition.name}.${field.name}"`)
    return this.#expression(this.root, effective, false)
  }

  /**
   * Resolve one filter path and its SQL expression.
   * @param context - Occurrence where traversal starts.
   * @param segments - Remaining path segments.
   * @param fullName - Full logical filter path.
   * @param contextKey - Stable logical prefix used for shared joins.
   * @param depth - Number of reference hops already traversed.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns The SQL expression, scalar field, and identity classification.
   */
  #resolveFilterPath(
    context: EntityContext,
    segments: readonly string[],
    fullName: string,
    contextKey = '',
    depth = 0,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): {
    count?: CountScope,
    expression: string,
    field: QueryFieldDefinition,
    identity: boolean,
    render?: (bind: (value: BoundScalar) => string) => string,
  } {
    const [segment] = segments
    if (segment === undefined) throw new Error(`Invalid filter path "${fullName}"`)
    const rest = segments.slice(1)
    if (rest.length === 1 && (rest[0] === '$total' || rest[0] === '$matched')) {
      const directives = parseCollectionDirectives(segment)
      if (directives.limit !== undefined
        || directives.offset !== undefined
        || directives.orderBy !== undefined) {
        throw new Error(
          `Collection ${rest[0]} does not accept limit, offset, or orderBy directives`,
        )
      }
      const key = fullName.slice(0, -(rest[0].length + 1))
      const collection = context.collections.get(directives.name)
      if (collection) {
        const plan = this.#collectionPlan(collection, context.baseAlias, key)
        this.#consume(plan.work)
        if (rest[0] === '$matched' && directives.filter !== undefined) {
          return {
            expression: '',
            field: { name: fullName, type: FieldType.Number },
            identity: false,
            render: this.#collectionMatchedRenderer(plan, directives.filter),
          }
        }
        const count = this.#collectionCountExpression(
          plan,
          `${fullName}\u0000${context.baseAlias}`,
        )
        return {
          count,
          expression: '',
          field: { name: fullName, type: FieldType.Number },
          identity: false,
        }
      }
      if (directives.filter !== undefined) {
        throw new Error(`Collection filter "${fullName}" requires a collection navigation`)
      }
      const countField = context.effective.get(directives.name)
      if (countField?.type === FieldType.Array) {
        const expression = this.#arrayCountExpression(context, countField, scope)
        const count = {
          empty: `COALESCE(cardinality(${expression}), 0) = 0`,
          exists: `COALESCE(cardinality(${expression}), 0) > 0`,
          expression: `COALESCE(cardinality(${expression}), 0)`,
        }
        this.#consume()
        return {
          count,
          expression: '',
          field: { name: fullName, type: FieldType.Number },
          identity: false,
        }
      }
      throw new Error(`Query count path "${fullName}" requires a collection or native array field`)
    }
    const field = context.effective.get(segment)
    if (field) {
      if (rest.length === 0) {
        if (field.type === FieldType.Entity) {
          const target = this.#entities.entity(field.target)
          const sourceAlias = this.#ownerAlias(context, field.owner, false, scope)
          return {
            expression: `${sourceAlias}.${quote(field.column)}`,
            field: {
              ...(target?.idFormat ? { format: target.idFormat } : {}),
              name: fullName,
              type: FieldType.ID,
            },
            identity: true,
          }
        }
        return {
          expression: this.#expression(context, field, false, false, scope),
          field: (fullName.includes('.') ? { ...field, name: fullName } : field) as QueryFieldDefinition,
          identity: false,
        }
      }
      if (field.type !== FieldType.Entity) {
        throw new Error(`Filter path "${fullName}" traverses non-reference field "${segment}"`)
      }
      if (rest.length === 1 && rest[0] === 'id') {
        const target = this.#entities.entity(field.target)
        const sourceAlias = this.#ownerAlias(context, field.owner, false, scope)
        return {
          expression: `${sourceAlias}.${quote(field.column)}`,
          field: {
            ...(target?.idFormat ? { format: target.idFormat } : {}),
            name: fullName,
            type: FieldType.ID,
          },
          identity: true,
        }
      }
      if (depth >= MAX_REFERENCE_DEPTH) {
        throw new Error(`Reference path "${fullName}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
      }
      const childKey = contextKey === '' ? segment : `${contextKey}.${segment}`
      const sourceAlias = this.#ownerAlias(context, field.owner, false, scope)
      const targetOccurrence = this.#filterTarget(field, sourceAlias, childKey, scope)
      return this.#resolveFilterPath(targetOccurrence, rest, fullName, childKey, depth + 1, scope)
    }

    const descendant = context.descendants.get(segment)
    if (!descendant) throw new Error(`Unknown field "${context.definition.name}.${segment}"`)
    if (descendant.contracts.size > 1) {
      throw new Error(`Descendant field "${context.definition.name}.${segment}" has incompatible declarations`)
    }
    if (rest.length === 0) {
      if (descendant.type === FieldType.Entity) {
        if (depth >= MAX_REFERENCE_DEPTH) {
          throw new Error(`Reference path "${fullName}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
        }
        const branches = descendant.variants.map(variant => {
          const owner = this.#ownerAlias(context, variant.owner, true, scope)
          const variantKey = `${contextKey}.${segment}#${variant.owner}`
          const targetOccurrence = this.#filterTarget(variant.field, owner, variantKey, scope)
          const leaves = variant.leaves.map(quoteLiteral).join(', ')
          return `WHEN ${this.#ensureRoot(context, scope)}.${quote('entity')} IN (${leaves}) ` +
            `THEN ${targetOccurrence.rootAlias}.${quote('id')}`
        })
        const targetField = descendant.variants[0]?.field
        const target = targetField?.type === FieldType.Entity ? this.#entities.entity(targetField.target) : undefined
        return {
          expression: `CASE ${branches.join(' ')} ELSE NULL END`,
          field: {
            ...(target?.idFormat ? { format: target.idFormat } : {}),
            name: fullName,
            type: FieldType.ID,
          },
          identity: true,
        }
      }
      const variant = descendant.variants[0]
      if (!variant) throw new Error(`Descendant field "${context.definition.name}.${segment}" has no declaration`)
      return {
        expression: this.#descendantExpression(context, descendant, scope),
        field: { ...variant.field, name: fullName } as QueryFieldDefinition,
        identity: false,
      }
    }
    if (descendant.type !== FieldType.Entity) {
      throw new Error(`Filter path "${fullName}" traverses non-reference field "${segment}"`)
    }
    if (depth >= MAX_REFERENCE_DEPTH) {
      throw new Error(`Reference path "${fullName}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
    }
    const root = this.#ensureRoot(context, scope)
    let resolvedField: QueryFieldDefinition | undefined
    let resolvedIdentity = false
    let resolvedCount: CountScope | undefined
    const branches = descendant.variants.map(variant => {
      const owner = this.#ownerAlias(context, variant.owner, true, scope)
      const variantKey = `${contextKey}.${segment}#${variant.owner}`
      const targetOccurrence = this.#filterTarget(variant.field, owner, variantKey, scope)
      const resolved = this.#resolveFilterPath(targetOccurrence, rest, fullName, variantKey, depth + 1, scope)
      resolvedIdentity = resolved.identity
      if (resolved.count) resolvedCount = resolved.count
      if (!resolvedField) resolvedField = resolved.field
      else if (
        resolvedField.type !== resolved.field.type
        || ('format' in resolvedField ? resolvedField.format : undefined) !==
          ('format' in resolved.field ? resolved.field.format : undefined)
      ) {
        throw new Error(`Filter path "${fullName}" has incompatible descendant declarations`)
      }
      const leaves = variant.leaves.map(quoteLiteral).join(', ')
      const branchExpression = resolved.count?.expression ?? resolved.expression
      return `WHEN ${root}.${quote('entity')} IN (${leaves}) THEN ${branchExpression}`
    })
    if (!resolvedField) throw new Error(`Filter path "${fullName}" has no descendant declaration`)
    const expression = `CASE ${branches.join(' ')} ELSE NULL END`
    if (resolvedCount) {
      return {
        count: {
          empty: `COALESCE((${expression}), 0) = 0`,
          exists: `COALESCE((${expression}), 0) > 0`,
          expression,
        },
        expression,
        field: { ...resolvedField, name: fullName },
        identity: resolvedIdentity,
      }
    }
    return {
      expression,
      field: { ...resolvedField, name: fullName },
      identity: resolvedIdentity,
    }
  }

  /**
   * Build the conditional expression for one descendant scalar field.
   * @param context - Occurrence exposing the descendant.
   * @param descendant - Descendant field metadata.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns SQL expression selecting the field value by concrete leaf.
   */
  #descendantExpression(
    context: EntityContext,
    descendant: DescendantField,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): string {
    const root = this.#ensureRoot(context, scope)
    const branches = descendant.variants.map(variant => {
      const owner = this.#ownerAlias(context, variant.owner, true, scope)
      const leaves = variant.leaves.map(quoteLiteral).join(', ')
      return `WHEN ${root}.${quote('entity')} IN (${leaves}) THEN ${owner}.${quote(variant.field.name)}`
    })
    return `CASE ${branches.join(' ')} ELSE NULL END`
  }

  /**
   * Build or reuse one collection relation plan.
   * @param collection - Collection navigation.
   * @param parentAlias - Alias of the occurrence owning the collection.
   * @param key - Stable logical collection path.
   * @returns The reusable relation plan.
   */
  #collectionPlan(
    collection: DerivedCollectionDefinition,
    parentAlias: string,
    key: string,
  ): CollectionRelationPlan {
    const planKey = `${key}\u0000${parentAlias}`
    const cached = this.#collectionPlans.get(planKey)
    if (cached) return cached
    const resolved = resolveCollectionRelation(collection, value => this.#entities.entity(value))
    const targetName = resolved.target.kind === 'entity' ? resolved.target.definition.name : undefined
    const targetAlias = resolved.resultType === 'entity' && targetName !== 'Entity'
      ? this.#nextAlias('ct')
      : undefined
    const rootAlias = resolved.resultType === 'entity' ? this.#nextAlias('cr') : undefined
    const relationshipAlias = resolved.source.kind === 'relationship' ? this.#nextAlias('cj') : undefined
    const sql = collectionSqlRelation(
      this.#entities,
      resolved,
      `"${parentAlias}".${quote('id')}`,
      {
        relationship: relationshipAlias ?? '',
        root: rootAlias ?? '',
        target: targetAlias ?? '',
      },
    )
    const relationship = resolved.source.kind === 'relationship' ? resolved.source.relationship : undefined
    const targetEndpoint = resolved.source.kind === 'relationship' ? resolved.source.remote : undefined
    const target = resolved.target.kind === 'record'
      ? recordProjectionView(resolved.target.relationship)
      : resolved.target.definition
    const plan: CollectionRelationPlan = {
      collection,
      condition: sql.condition,
      parentAlias,
      relation: sql.relation,
      resultType: sql.resultType,
      target,
      work: resolved.resultType === 'record'
        ? 1
        : resolved.source.kind === 'inverse'
          ? targetAlias === undefined ? 1 : 2
          : targetAlias === undefined ? 2 : 3,
      ...(sql.predicate === undefined ? {} : { predicate: sql.predicate }),
      ...(relationship === undefined ? {} : { relationship }),
      ...(relationshipAlias === undefined ? {} : { relationshipAlias }),
      ...(rootAlias === undefined ? {} : { rootAlias }),
      ...(targetAlias === undefined ? {} : { targetAlias }),
      ...(targetEndpoint === undefined ? {} : { targetEndpoint }),
    }
    this.#collectionPlans.set(planKey, plan)
    return plan
  }

  /**
   * Correlate one child query to a collection relation plan.
   * @param plan - Collection relation plan.
   * @param alias - Child target alias.
   * @returns Correlated existence condition.
   */
  #collectionCorrelation(plan: CollectionRelationPlan, alias: string): SqlFragment {
    const predicate = plan.predicate === undefined
      ? undefined
      : SQL.compose([' AND (', plan.predicate, ')'])
    const rootAlias = plan.rootAlias
    if (rootAlias === undefined) {
      throw new Error(`Entity collection "${plan.collection.name}" has no identity root`)
    }
    return SQL.compose([
      'EXISTS (SELECT 1 FROM ', plan.relation, ' WHERE ', plan.condition, predicate,
      ' AND ', `${quote(rootAlias)}.${quote('id')} = ${quote(alias)}.${quote('id')}`, ')',
    ])
  }

  /**
   * Correlate one child query to qualifying source edges for a member filter.
   *
   * The filter is compiled against the collection relation joined to its
   * target, so target and relationship predicates must match the same edge.
   * @param plan - Collection relation plan.
   * @param key - Stable logical collection path.
   * @param filter - Collection member predicate.
   * @param alias - Child target alias.
   * @returns Correlated existence condition with the filter and bound values.
   */
  #filteredCollectionCorrelation(
    plan: CollectionRelationPlan,
    key: string,
    filter: string,
    alias: string,
  ): SqlFragment {
    const scope = this.#scopeForCollection(
      { collection: plan.collection, parentAlias: plan.parentAlias },
      key,
      false,
    )
    const normalized = QueryNormalizer.normalize(
      plan.target,
      filter,
      scope.field,
      scope.collection,
      scope.array,
    ) ?? undefined
    const predicate = SQL.where(this.#entities, plan.target.name, normalized, scope)
    const identity = scope.expression(scope.field('id'))
    const filterFragment = predicate.sql === ''
      ? undefined
      : { sql: predicate.sql.replace(/^WHERE\s+/u, ''), values: predicate.values }
    return SQL.compose([
      'EXISTS (SELECT 1 FROM ', scope.relation, ' WHERE ', scope.condition,
      scope.predicate === undefined ? undefined : SQL.compose([' AND (', scope.predicate, ')']),
      filterFragment === undefined ? undefined : SQL.compose([' AND (', filterFragment, ')']),
      ' AND ', identity, ' = ', `${quote(alias)}.${quote('id')}`, ')',
    ])
  }

  /**
   * Render the authorized count of collection members matching one filter.
   * @param plan - Collection relation plan.
   * @param filter - Collection member predicate.
   * @returns Renderer that binds filter values into the outer predicate.
   */
  #collectionMatchedRenderer(
    plan: CollectionRelationPlan,
    filter: string,
  ): (bind: (value: BoundScalar) => string) => string {
    const spec: ProjectedCollectionSpec = {
      collection: plan.collection,
      directivesSeen: true,
      edgeFields: new Set(),
      fields: new Set(),
      filters: new Set(),
    }
    const adapter = plan.resultType === 'record'
      ? this.#recordMember(plan, spec, true)
      : this.#entityMember(plan, spec, plan.collection.name, true)
    const count = collectionIdentityCount(adapter.compile(filter), adapter.identity, adapter.identityUnique)
    return bind => `(${SQL.bindFragment(count, bind)})`
  }

  /**
   * Build the predicate scope for one relationship-record collection.
   * @param plan - Record collection relation plan.
   * @returns A query scope resolving record endpoint and property fields.
   */
  #recordScope(plan: CollectionRelationPlan): QueryScope {
    const definition = plan.target
    const relationship = plan.relationship
    const alias = plan.relationshipAlias
    if (relationship === undefined || alias === undefined) {
      throw new Error(`Record collection "${plan.collection.name}" has no relationship source`)
    }
    const endpoints = new Map(relationship.between.map(endpoint => [endpoint.field, endpoint]))
    const fields = new Map<string, QueryFieldDefinition>(
      definition.effectiveFields.map(field => [field.name, field as QueryFieldDefinition]),
    )
    return {
      definition,
      expression: field => {
        const endpoint = endpoints.get(field.name)
        return `${quote(alias)}.${quote(
          endpoint === undefined ? field.name : `${endpoint.field}.id`,
        )}`
      },
      field: name => {
        const endpoint = endpoints.get(name)
        if (endpoint !== undefined) return { name, type: FieldType.ID }
        const field = fields.get(name)
        if (!field) throw new Error(`Unknown collection record field "${name}"`)
        return field
      },
    }
  }

  /**
   * Lower one record-collection member predicate.
   * @param plan - Record collection relation plan.
   * @param filter - Collection member predicate, when present.
   * @returns The normalized SQL predicate.
   */
  #recordPredicate(plan: CollectionRelationPlan, filter?: string): ReturnType<typeof SQL.where> {
    if (filter === undefined) return { sql: '', values: [] }
    const scope = this.#recordScope(plan)
    const normalized = QueryNormalizer.normalize(
      plan.target,
      filter,
      scope.field,
      scope.collection,
      scope.array,
    ) ?? undefined
    return SQL.where(this.#entities, plan.target.name, normalized, scope)
  }

  /**
   * Build the correlated scope used by one collection comparison.
   * @param name - Root collection navigation name.
   * @returns Collection scope, or undefined when the name is not a collection.
   */
  collectionScope(name: string): CollectionScope | undefined {
    const cached = this.#collectionScopes.get(name)
    if (cached) return cached
    const resolved = this.#resolveCollectionPath(this.root, name, this.#outerFilterScope())
    if (!resolved) return undefined
    const scope = this.#scopeForCollection(resolved, name, true)
    this.#collectionScopes.set(name, scope)
    return scope
  }

  /**
   * Resolve a collection navigation relative to one occurrence, including
   * composed singular-reference prefixes.
   * @param context - Occurrence where the path starts.
   * @param name - Collection navigation or dotted reference path.
   * @param sink - Local join sink for reference traversal.
   * @returns The collection and its parent occurrence, or undefined when absent.
   */
  #resolveCollectionPath(
    context: EntityContext,
    name: string,
    sink: FilterJoinScope,
  ): { collection: DerivedCollectionDefinition, context: EntityContext, parentAlias: string } | undefined {
    const resolved = resolveCollectionPath(abstractEntityView(this.#entities, context.definition), name, {
      resolve: value => {
        const entity = this.#entities.entity(value)
        return entity === undefined ? undefined : abstractEntityView(this.#entities, entity)
      },
    })
    if (!resolved) return undefined
    if ('kind' in resolved) {
      if (resolved.kind === 'depth') {
        throw new Error(`Collection path "${name}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
      }
      return undefined
    }
    if (resolved.prefix === '') {
      return { collection: resolved.collection, context, parentAlias: context.baseAlias }
    }
    const prefix = resolveFieldPath(
      abstractEntityView(this.#entities, context.definition),
      resolved.prefix,
      {
        resolve: value => {
          const entity = this.#entities.entity(value)
          return entity === undefined ? undefined : abstractEntityView(this.#entities, entity)
        },
      },
    )
    if ('kind' in prefix) return undefined
    let current = context
    for (const hop of prefix.hops) {
      const sourceAlias = this.#ownerAlias(current, hop.field.owner, false, sink)
      current = this.#filterTarget(hop.field, sourceAlias, hop.path, sink)
    }
    if (prefix.terminal.type !== FieldType.Entity) return undefined
    const sourceAlias = this.#ownerAlias(current, prefix.terminal.owner, false, sink)
    const owner = this.#filterTarget(prefix.terminal, sourceAlias, resolved.prefix, sink)
    return { collection: resolved.collection, context: owner, parentAlias: owner.baseAlias }
  }

  /**
   * Build the correlated scope used by one resolved collection.
   * @param resolved - Resolved collection and its owning occurrence.
   * @param resolved.collection - Collection navigation.
   * @param resolved.parentAlias - Alias of the occurrence owning the collection.
   * @param name - Stable logical collection path.
   * @param root - Whether this is a root-level collection.
   * @returns The collection scope.
   */
  #scopeForCollection(
    resolved: { collection: DerivedCollectionDefinition, parentAlias: string },
    name: string,
    root: boolean,
  ): CollectionScope {
    const plan = this.#collectionPlan(resolved.collection, resolved.parentAlias, name)
    this.#consume(plan.work)
    const relationship = plan.relationship
    const relationshipAlias = plan.relationshipAlias
    const condition = plan.condition
    if (root) {
      this.#countFields.set(
        `${name}.$total`,
        this.#collectionCountExpression(plan, `${name}.$total\u0000${resolved.parentAlias}`),
      )
    }
    if (plan.resultType === 'record') {
      const recordScope = this.#recordScope(plan)
      const endpoints = new Set(plan.relationship?.between.map(endpoint => endpoint.field) ?? [])
      return {
        array: nested => {
          const field = recordScope.field(nested)
          if (field.type !== FieldType.Array) return undefined
          return {
            expression: recordScope.expression(field),
            field,
            member: arrayItemField(field),
          }
        },
        collection: () => undefined,
        condition,
        consume: units => this.#consume(units),
        definition: plan.target,
        expression: field => recordScope.expression(field),
        field: fieldName => recordScope.field(fieldName),
        filterKind: path => (endpoints.has(path) ? 'identity' : undefined),
        predicate: plan.predicate,
        relation: plan.relation,
        work: plan.work,
      }
    }
    const rootAlias = plan.rootAlias
    if (rootAlias === undefined) {
      throw new Error(`Entity collection "${plan.collection.name}" has no identity root`)
    }
    const context: EntityContext = plan.targetAlias === undefined
      ? rootContext(this.#entities, rootAlias)
      : targetContext(this.#entities, plan.target, plan.targetAlias, rootAlias)
    const expressions = new Map<string, string>()
    const identities = new Set<string>()
    const resolvedFields = new Map<string, QueryFieldDefinition>()
    const joins: string[] = []
    const sink: FilterJoinScope = {
      alias: prefix => this.#nextAlias(prefix),
      cache: new Map(),
      consume: units => this.#consume(units),
      join: sql => joins.push(sql),
    }
    const resolve = (path: string): QueryFieldDefinition => {
      const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
      const cachedField = resolvedFields.get(normalized)
      if (cachedField) return cachedField
      path = normalized
      if (relationshipAlias !== undefined && relationship) {
        const prefix = `${lowerFirst(relationship.name)}.`
        if (path.startsWith(prefix)) {
          const fieldName = path.slice(prefix.length)
          const endpoint = relationship.between.find(candidate => candidate.field === fieldName)
          if (endpoint !== undefined) {
            const field: QueryFieldDefinition = { name: path, type: FieldType.ID }
            resolvedFields.set(path, field)
            expressions.set(path, `"${relationshipAlias}".${quote(`${endpoint.field}.id`)}`)
            identities.add(path)
            return field
          }
          const property = relationship.fields.find(candidate => candidate.name === fieldName)
          if (!property) {
            throw new Error(`Unknown relationship field "${relationship.name}.${fieldName}"`)
          }
          if (property.type === FieldType.Array || property.type === FieldType.JSON) {
            throw new Error(
              `Relationship field "${relationship.name}.${fieldName}" is not a scalar property`,
            )
          }
          const field: QueryFieldDefinition = { ...property, name: path }
          resolvedFields.set(path, field)
          expressions.set(path, `"${relationshipAlias}".${quote(property.name)}`)
          return field
        }
        if (!path.includes('.')) {
          const property = relationship.fields.find(candidate => candidate.name === path)
          if (property !== undefined) {
            if (context.effective.has(path)) {
              throw new Error(
                `Ambiguous collection field "${path}": target and relationship both declare it`,
              )
            }
            if (property.type === FieldType.Array || property.type === FieldType.JSON) {
              throw new Error(`Relationship field "${relationship.name}.${path}" is not a scalar property`)
            }
            const field: QueryFieldDefinition = { ...property, name: path }
            resolvedFields.set(path, field)
            expressions.set(path, `"${relationshipAlias}".${quote(path)}`)
            return field
          }
        }
      }
      const segments = path.split('.')
      if (segments.some(segment => segment.length === 0)) throw new Error(`Invalid filter path "${path}"`)
      const result = this.#resolveFilterPath(context, segments, path, '', 0, sink)
      resolvedFields.set(path, result.field)
      expressions.set(path, result.expression)
      if (result.identity) identities.add(path)
      return result.field
    }
    const scope: CollectionScope = {
      array: nested => this.#arrayScopeFor(context, nested, sink),
      collection: nested => {
        const inner = this.#resolveCollectionPath(context, nested, sink)
        return inner ? this.#scopeForCollection(inner, `${name}.${nested}`, false) : undefined
      },
      condition,
      consume: units => this.#consume(units),
      definition: plan.target,
      expression: field => {
        const expression = expressions.get(field.name)
        if (!expression) throw new Error(`Unresolved collection field "${field.name}"`)
        return expression
      },
      field: resolve,
      filterKind: path => (identities.has(path) ? 'identity' : undefined),
      predicate: plan.predicate,
      get relation() { return [plan.relation, ...joins].join(' ') },
      get work() { return plan.work + joins.length },
    }
    return scope
  }

  /**
   * Build count SQL metadata for one collection plan.
   * @param plan - Reusable collection relation plan.
   * @param key - Stable physical count path.
   * @returns Count expression and canonical existence forms.
   */
  #collectionCountExpression(plan: CollectionRelationPlan, key: string): CountScope {
    const cached = this.#countScopes.get(key)
    if (cached) return cached
    const spec: ProjectedCollectionSpec = {
      collection: plan.collection,
      directivesSeen: true,
      edgeFields: new Set(),
      fields: new Set(),
      filters: new Set(),
    }
    const adapter = plan.resultType === 'record'
      ? this.#recordMember(plan, spec, true)
      : this.#entityMember(plan, spec, key, true)
    const member = adapter.compile(undefined)
    const count = collectionIdentityCount(member, adapter.identity, adapter.identityUnique)
    const exists = SQL.compose(['EXISTS (SELECT 1 FROM (', member, ') AS "__member")'])
    const empty = SQL.compose(['NOT EXISTS (SELECT 1 FROM (', member, ') AS "__member")'])
    const scope: CountScope = {
      empty: bind => SQL.bindFragment(empty, bind),
      exists: bind => SQL.bindFragment(exists, bind),
      expression: count.values.length === 0 ? `(${count.sql})` : '',
      fragment: count,
      render: bind => `(${SQL.bindFragment(count, bind)})`,
    }
    this.#countScopes.set(key, scope)
    return scope
  }

  /**
   * Build the scoped native-array relation used by one member predicate.
   * @param name - Logical array field or dotted reference path.
   * @returns Array scope, or undefined when the name is not an array.
   */
  arrayScope(name: string): ArrayScope | undefined {
    return this.#arrayScopeFor(this.root, name, this.#outerFilterScope())
  }

  /**
   * Build one native-array member scope relative to an occurrence.
   * @param context - Occurrence where the path starts.
   * @param name - Logical array field or dotted reference path.
   * @param sink - Local join sink for reference traversal.
   * @returns Array scope, or undefined when the name is not an array.
   */
  #arrayScopeFor(
    context: EntityContext,
    name: string,
    sink: FilterJoinScope,
  ): ArrayScope | undefined {
    if (context.collections.has(name)) return undefined
    try {
      const segments = name.split('.')
      if (segments.some(segment => segment.length === 0)) return undefined
      const result = this.#resolveFilterPath(context, segments, name, '', 0, sink)
      if (result.field.type !== FieldType.Array) return undefined
      return {
        consume: units => this.#consume(units),
        expression: result.expression,
        field: result.field,
        member: arrayItemField(result.field),
      }
    } catch {
      return undefined
    }
  }

  /**
   * Build the cardinality expression for one native array count.
   * @param context - Occurrence owning the array.
   * @param field - Effective array field.
   * @param scope - Local SQL join sink.
   * @returns SQL cardinality expression.
   */
  #arrayCountExpression(
    context: EntityContext,
    field: EffectiveFieldDefinition,
    scope: FilterJoinScope,
  ): string {
    return this.#expression(context, field, false, false, scope)
  }

  /**
   * Resolve one filter count path.
   * @param name - Logical count path.
   * @returns Count expression forms, or undefined for ordinary fields.
   */
  filterCount(name: string): CountScope | undefined {
    return this.#countFields.get(name)
  }

  /**
   * Resolve a root scalar or collection count path for ordering.
   * @param name - Root field or count path.
   * @returns The scalar field.
   */
  orderField(name: string): QueryFieldDefinition {
    if (name.endsWith('.$total')) return this.filterField(name)
    const field = this.root.effective.get(name)
    if (!field) throw new Error(`Unknown field "${this.root.definition.name}.${name}"`)
    if (field.type === FieldType.Entity) {
      throw new Error(
        `Query field "${this.root.definition.name}.${name}" is an entity reference; ` +
        'references cannot be used in predicates or ordering',
      )
    }
    return field
  }

  /**
   * Resolve one filter path, adding required reference joins.
   * @param name - Logical root field or dotted singular-reference path.
   * @returns The effective scalar or identity field.
   */
  filterField(name: string): QueryFieldDefinition {
    const cached = this.#filterFields.get(name)
    if (cached) return cached
    const segments = splitFieldPath(name)
    if (segments.some(segment => segment.length === 0)) {
      throw new Error(`Invalid filter path "${name}"`)
    }
    const resolved = this.#resolveFilterPath(this.root, segments, name, '', 0)
    if (resolved.render) this.#filterRenders.set(name, resolved.render)
    else if (resolved.count) this.#countFields.set(name, resolved.count)
    else this.#filterExpressions.set(name, resolved.expression)
    this.#filterFields.set(name, resolved.field)
    if (resolved.identity) this.#filterIdentities.add(name)
    return resolved.field
  }

  /**
   * Resolve whether a filter path is a reference identity.
   * @param name - Logical filter path.
   * @returns `identity` for reference endpoints, otherwise undefined.
   */
  filterKind(name: string): 'identity' | undefined {
    return this.#filterIdentities.has(name) ? 'identity' : undefined
  }

  /**
   * Add one projection path below an occurrence.
   * @param node - Current occurrence.
   * @param segments - Remaining path segments.
   * @param traversal - Reciprocal association state from the previous step.
   * @param depth - Number of reference hops already traversed.
   */
  #addPath(
    node: ProjectionNode,
    segments: readonly string[],
    traversal: TraversalState | undefined,
    depth: number,
  ): void {
    const rawName = segments[0]
    if (rawName === undefined) throw new Error('Query field path cannot be empty')
    const directives = parseCollectionDirectives(rawName)
    const name = directives.name
    const rest = segments.slice(1)
    const path = [
      ...node.path,
      name,
      ...rest.map(segment => parseCollectionDirectives(segment).name),
    ].join('.')
    const hasDirectives = directives.filter !== undefined || directives.limit !== undefined
      || directives.offset !== undefined || directives.orderBy !== undefined
    if (hasDirectives && rest.length > 0) {
      throw new Error(`Collection directives must end the path "${rawName}"; use separate child paths`)
    }
    if (rest.length === 1 && rest[0] === '$total') {
      const collection = node.context.collections.get(name)
      if (collection) {
        const key = collectionKey(node.path, collection.name)
        const plan = this.#collectionPlan(collection, node.context.baseAlias, key)
        this.#consume(plan.work)
        const count = this.#collectionCountExpression(plan, `${path}\u0000${node.context.baseAlias}`)
        if (count.fragment === undefined) {
          this.#addComputedScalar(node, `${name}.$total`, count.expression)
        } else {
          this.#addComputedFragment(node, `${name}.$total`, count.fragment)
        }
        return
      }
      const field = node.context.effective.get(name)
      if (field?.type === FieldType.Array) {
        this.#consume()
        const expression = this.#expression(node.context, field, false)
        this.#addComputedScalar(node, `${name}.$total`, `COALESCE(cardinality(${expression}), 0)`)
        return
      }
      throw new Error(`Query count path "${path}" requires a collection or native array field`)
    }
    const singular = node.context.singularNavigations.get(name)
    if (singular) {
      if (traversal?.direction === 'forward' && traversal.association === singular.association) {
        throw new Error(`Reciprocal reference backtracking "${path}"`)
      }
      if (depth >= MAX_REFERENCE_DEPTH) {
        throw new Error(`Reference path "${path}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
      }
      let reference = node.referenceNames.get(name)
      if (!reference) {
        reference = {
          associations: [singular.association],
          name,
          nodes: [this.#inverseTarget(node, singular, [...node.path, name])],
        }
        node.referenceNames.set(name, reference)
        node.references.push(reference)
      }
      if (rest.length > 0) {
        for (const child of reference.nodes) {
          this.#addPath(child, rest, {
            association: singular.association,
            direction: 'inverse',
          }, depth + 1)
        }
      }
      return
    }
    const collection = node.context.collections.get(name)
    if (collection) {
      if (rest.length > 0
        && collection.kind === 'inverse'
        && rest[0] === collection.association.forward.name) {
        throw new Error(`Reciprocal reference backtracking "${path}"`)
      }
      const key = collectionKey(node.path, collection.name)
      let spec = node.projectedSpecs.get(collection.name)
      if (spec === undefined) {
        spec = {
          collection,
          directivesSeen: false,
          edgeFields: new Set(),
          fields: new Set(),
          filters: new Set(),
        }
        node.projectedSpecs.set(collection.name, spec)
      }
      if (hasDirectives) {
        if (spec.directivesSeen) {
          throw new Error(`Collection "${key}" receives more than one directive path`)
        }
        spec.directivesSeen = true
        if (directives.filter !== undefined) spec.filters.add(directives.filter)
        if (directives.limit !== undefined) spec.limit = directives.limit
        if (directives.offset !== undefined) spec.offset = directives.offset
        if (directives.orderBy !== undefined) spec.orderBy = directives.orderBy
      }
      if (rest.length === 0) return
      if (collection.kind === 'relationship' || collection.kind === 'explicit') {
        const edge = relationshipProperty(this.#entities, collection, rest[0], path)
        if (edge !== undefined) {
          if (rest.length > 1) {
            throw new Error(`Cannot traverse relationship property "${path}"`)
          }
          if (edge.type === FieldType.Array || edge.type === FieldType.JSON) {
            throw new Error(`Relationship property "${path}" is not a scalar field`)
          }
          spec.edgeFields.add(edge.name)
          return
        }
      }
      spec.fields.add(rest.join('.'))
      return
    }
    if (hasDirectives) {
      throw new Error(`Collection directive "${rawName}" is not a collection navigation`)
    }

    const effective = node.context.effective.get(name)

    if (effective) {
      if (effective.type === FieldType.Entity) {
        const association = this.#entities.association(effective.owner, effective.name)
        if (traversal?.direction === 'inverse' && traversal.association === association) {
          throw new Error(`Reciprocal reference backtracking "${path}"`)
        }
        if (depth >= MAX_REFERENCE_DEPTH) {
          throw new Error(`Reference path "${path}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
        }
        let reference = node.referenceNames.get(name)
        if (!reference) {
          reference = { associations: [association], name, nodes: [this.#reference(node, effective)] }
          node.referenceNames.set(name, reference)
          node.references.push(reference)
        }
        if (rest.length > 0) {
          for (const [index, child] of reference.nodes.entries()) {
            const referenceAssociation = reference.associations[index]
            this.#addPath(
              child,
              rest,
              referenceAssociation
                ? { association: referenceAssociation, direction: 'forward' }
                : undefined,
              depth + 1,
            )
          }
        }
        return
      }
      if (rest.length > 0) {
        throw new Error(`Cannot traverse scalar field "${node.context.definition.name}.${segments.join('.')}"`)
      }
      this.#addScalar(node, name)
      return
    }

    const descendant = node.context.descendants.get(name)
    if (descendant) {
      if (descendant.contracts.size > 1) {
        throw new Error(
          `Descendant field "${node.context.definition.name}.${name}" has incompatible declarations`,
        )
      }
      if (descendant.type === FieldType.Entity) {
        if (depth >= MAX_REFERENCE_DEPTH) {
          throw new Error(`Reference path "${path}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
        }
        let reference = node.referenceNames.get(name)
        if (!reference) {
          const selected = descendant.variants
            .map(variant => ({
              association: this.#entities.association(variant.field.owner, variant.field.name),
              variant,
            }))
            .filter(({ association }) => !(
              traversal?.direction === 'inverse' && association === traversal.association
            ))
          if (selected.length === 0) {
            throw new Error(`Reciprocal reference backtracking "${path}"`)
          }
          const nodes = selected.map(({ variant }, index) => {
            const sourceAlias = this.#ownerAlias(node.context, variant.owner, true)
            return this.#target(
              variant.field,
              [...node.path, `${name}__v${index}`],
              sourceAlias,
            )
          })
          reference = {
            associations: selected.map(({ association }) => association),
            name,
            nodes,
          }
          node.referenceNames.set(name, reference)
          node.references.push(reference)
        }
        if (rest.length > 0) {
          for (const [index, child] of reference.nodes.entries()) {
            const referenceAssociation = reference.associations[index]
            this.#addPath(
              child,
              rest,
              referenceAssociation
                ? { association: referenceAssociation, direction: 'forward' }
                : undefined,
              depth + 1,
            )
          }
        }
        return
      }
      if (rest.length > 0) {
        throw new Error(`Cannot traverse scalar field "${node.context.definition.name}.${segments.join('.')}"`)
      }
      this.#addDescendantScalar(node, descendant)
      return
    }

    throw new Error(`Unknown field "${node.context.definition.name}.${segments.join('.')}"`)
  }

  /**
   * Create one singular-reference projection node.
   * @param source - Source occurrence containing the reference column.
   * @param field - Effective reference field.
   * @returns The child projection node.
   */
  #reference(source: ProjectionNode, field: EffectiveFieldDefinition): ProjectionNode {
    if (field.type !== FieldType.Entity) throw new Error(`Field "${field.name}" is not a reference`)
    const sourceAlias = this.#ownerAlias(source.context, field.owner, false)
    return this.#target(field, [...source.path, field.name], sourceAlias)
  }

  /**
   * Join one singular inverse target and create its projection node.
   * @param source - Source occurrence exposing the inverse navigation.
   * @param navigation - Derived singular inverse navigation.
   * @param path - Internal projection path for target aliases.
   * @returns The target projection node.
   */
  #inverseTarget(
    source: ProjectionNode,
    navigation: DerivedSingularDefinition,
    path: readonly string[],
  ): ProjectionNode {
    this.#consume()
    if (navigation.target === 'Entity') {
      const rootAlias = this.#nextAlias('r')
      this.joins.push(
        `LEFT JOIN "Entity" "${rootAlias}" ON ` +
        `"${rootAlias}"."id" = "${source.context.baseAlias}"."id"`,
      )
      const child = this.#node(rootContext(this.#entities, rootAlias), path)
      this.#identity(child)
      return child
    }
    const target = this.#entities.entity(navigation.target)
    if (!target) throw new Error(`Unknown target entity "${navigation.target}"`)
    const baseAlias = this.#nextAlias('b')
    const rootAlias = this.#nextAlias('r')
    this.joins.push(
      `LEFT JOIN "${target.name}" "${baseAlias}" ON ` +
      `"${baseAlias}".${quote(navigation.reference.column)} = "${source.context.baseAlias}"."id"`,
    )
    this.joins.push(
      `LEFT JOIN "Entity" "${rootAlias}" ON "${rootAlias}"."id" = "${baseAlias}"."id"`,
    )
    const child = this.#node(targetContext(this.#entities, target, baseAlias, rootAlias), path)
    this.#identity(child)
    return child
  }

  /**
   * Join one reference target and create its projection node.
   * @param field - Effective reference field.
   * @param path - Internal projection path for target aliases.
   * @param sourceAlias - Source table alias containing the reference column.
   * @returns The target projection node.
   */
  #target(
    field: EffectiveFieldDefinition,
    path: readonly string[],
    sourceAlias: string,
  ): ProjectionNode {
    if (field.type !== FieldType.Entity) throw new Error(`Field "${field.name}" is not a reference`)
    const key = path.some(segment => /__v\d+$/u.test(segment))
      ? path.join('.')
      : this.#filterPathKey(path)
    let context = this.#filterContexts.get(key)
    if (!context) {
      context = this.#joinTarget(field, sourceAlias)
      this.#filterContexts.set(key, context)
    }
    const child = this.#node(context, path)
    this.#identity(child)
    return child
  }

  /**
   * Join one reference target without creating hydratable identity columns.
   * @param field - Effective reference field.
   * @param sourceAlias - Source table alias containing the reference column.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns The target occurrence.
   */
  #joinTarget(
    field: EffectiveFieldDefinition,
    sourceAlias: string,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): EntityContext {
    if (field.type !== FieldType.Entity) throw new Error(`Field "${field.name}" is not a reference`)
    scope.consume()
    if (field.target === 'Entity') {
      const rootAlias = scope.alias('r')
      scope.join(
        `LEFT JOIN "Entity" "${rootAlias}" ON ` +
        `"${rootAlias}"."id" = ${sourceAlias}.${quote(field.column)}`,
      )
      return rootContext(this.#entities, rootAlias)
    }
    const target = this.#entities.entity(field.target)
    if (!target) throw new Error(`Unknown target entity "${field.target}"`)
    const baseAlias = scope.alias('b')
    const rootAlias = scope.alias('r')
    scope.join(
      `LEFT JOIN "${target.name}" "${baseAlias}" ON ` +
      `"${baseAlias}"."id" = ${sourceAlias}.${quote(field.column)}`,
    )
    scope.join(
      `LEFT JOIN "Entity" "${rootAlias}" ON "${rootAlias}"."id" = "${baseAlias}"."id"`,
    )
    return targetContext(this.#entities, target, baseAlias, rootAlias)
  }

  /**
   * Resolve or create a filter-only reference context.
   * @param field - Effective reference field.
   * @param sourceAlias - Source table alias.
   * @param key - Stable logical prefix key.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns The target occurrence.
   */
  #filterTarget(
    field: EffectiveFieldDefinition,
    sourceAlias: string,
    key: string,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): EntityContext {
    const cached = scope.cache.get(key)
    if (cached) return cached
    const context = this.#joinTarget(field, sourceAlias, scope)
    scope.cache.set(key, context)
    return context
  }

  /**
   * Build a stable key for one logical reference path.
   * @param path - Internal or logical path segments.
   * @returns Dotted logical path without variant suffixes.
   */
  #filterPathKey(path: readonly string[]): string {
    return path.map(segment => segment.replace(/__v\d+$/u, '')).join('.')
  }

  /**
   * Add one projected collection as a correlated child query.
   *
   * Entity-projected and relationship-record collections share the same
   * identity selection, filtering, counting, ordering, paging and envelope
   * assembly. Adapters own only physical row retrieval and hydration.
   * @param node - Projection occurrence owning the collection.
   * @param spec - Requested target and record fields.
   */
  #addProjectedCollection(node: ProjectionNode, spec: ProjectedCollectionSpec): void {
    const key = collectionKey(node.path, spec.collection.name)
    const plan = this.#collectionPlan(spec.collection, node.context.baseAlias, key)
    this.#consume(plan.work)
    const authored = plan.collection.kind === 'explicit' ? plan.collection : undefined
    const limit = spec.limit !== undefined
      ? spec.limit
      : authored?.viaLimit !== undefined ? authored.viaLimit : 3
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error(`Collection "${key}" $limit must be a non-negative integer or null`)
    }
    const offset = spec.offset !== undefined
      ? spec.offset
      : authored?.viaOffset !== undefined ? authored.viaOffset : 0
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Collection "${key}" $offset must be a non-negative integer`)
    }
    const orderBy = spec.orderBy ?? authored?.viaOrderBy
    const effective: ProjectedCollectionSpec = {
      ...spec,
      limit,
      offset,
      ...(orderBy === undefined ? {} : { orderBy }),
    }
    const filter = spec.filters.size === 0
      ? undefined
      : [...spec.filters].map(value => `(${value})`).join(' $and ')
    const adapter = plan.resultType === 'record'
      ? this.#recordMember(plan, effective)
      : this.#entityMember(plan, effective, key)
    const orderings = collectionOrderings(plan, effective.orderBy, adapter)
    const matched = adapter.compile(filter)
    const total = filter === undefined ? undefined : adapter.compile(undefined)
    const matchedCount = collectionIdentityCount(matched, adapter.identity, adapter.identityUnique)
    const totalCount = total === undefined
      ? undefined
      : collectionIdentityCount(total, adapter.identity, adapter.identityUnique)
    const page = collectionIdentityPage(
      matched,
      adapter.identity,
      orderings,
      limit,
      offset,
      adapter.identityUnique,
    )
    const items = collectionItems(page, orderings)
    const alias = columnAlias(node.path, spec.collection.name)
    const matchedAlias = `${alias}__matched`
    const totalAlias = totalCount === undefined ? matchedAlias : `${alias}__total`
    const lateralAlias = this.#nextAlias('pc')
    const lateral = SQL.compose([
      'LEFT JOIN LATERAL (SELECT (', items, ') AS "__items", (', matchedCount,
      ') AS "__matched"',
      totalCount === undefined ? undefined : SQL.compose([', (', totalCount, ') AS "__total"']),
      ') AS ', quote(lateralAlias), ' ON TRUE',
    ], { startIndex: this.#valueStart + this.values.length })
    this.joins.push(lateral.sql)
    this.values.push(...lateral.values)
    this.columns.push(
      `${quote(lateralAlias)}.${quote('__items')} AS ${quote(alias)}`,
      `${quote(lateralAlias)}.${quote('__matched')} AS ${quote(matchedAlias)}`,
      ...(totalCount === undefined
        ? []
        : [`${quote(lateralAlias)}.${quote('__total')} AS ${quote(totalAlias)}`]),
    )
    node.projectedCollections.push({
      alias,
      hydrate: row => {
        const raw = row[alias]
        const entries = Array.isArray(raw)
          ? raw
          : typeof raw === 'string' ? JSON.parse(raw) as unknown[] : []
        const matchedTotal = Number(row[matchedAlias] ?? 0)
        return {
          $matched: matchedTotal,
          $total: totalCount === undefined ? matchedTotal : Number(row[totalAlias] ?? 0),
          items: entries.map(entry => matched.hydrate(entry as Record<string, unknown>)),
        }
      },
      matchedAlias,
      name: spec.collection.name,
      totalAlias,
    })
  }

  /**
   * Build the physical member adapter for an Entity-projected collection.
   * @param plan - Collection relation plan.
   * @param spec - Requested projection paths.
   * @param key - Stable logical collection path.
   * @param countOnly - Whether only identity rows are required.
   * @returns The Entity member adapter.
   */
  #entityMember(
    plan: CollectionRelationPlan,
    spec: ProjectedCollectionSpec,
    key: string,
    countOnly = false,
  ): CollectionMemberAdapter {
    const target = plan.target
    const relationship = plan.relationship
    const prefix = relationship === undefined ? '' : `${lowerFirst(relationship.name)}.`
    const targetFields = countOnly ? new Set<string>() : new Set(spec.fields)
    const edgeFields = countOnly ? [] : [...spec.edgeFields]
    if (plan.collection.kind === 'explicit' && relationship !== undefined && prefix !== '') {
      const projected = [...targetFields].filter(name => name.startsWith(prefix))
      if (projected.length > 0 && !this.#edgeProjectionAllowed(plan)) {
        throw new Error(
          `Entity collection "${plan.collection.name}" cannot project relationship-owned field ` +
          `"${projected[0]}"; one Entity may map to multiple edges`,
        )
      }
      for (const name of projected) {
        targetFields.delete(name)
        edgeFields.push(name.slice(prefix.length))
      }
      if (edgeFields.length > 0 && !this.#edgeProjectionAllowed(plan)) {
        throw new Error(
          `Entity collection "${plan.collection.name}" cannot project relationship-owned field ` +
          `"${prefix}${edgeFields[0]}"; one Entity may map to multiple edges`,
        )
      }
    }
    const requested = countOnly
      ? new Set(['id'])
      : new Set(['id', 'name', 'entity', ...targetFields])
    const orderFields = countOnly ? [] : collectionOrderNames(plan, spec.orderBy)
    const fields = [...new Set([...requested, ...orderFields])]
    const projectedEdgeFields = [...new Set(edgeFields)]
    const orderOnly = new Set(fields.filter(name => !requested.has(name)))
    const childAlias = this.#nextAlias(countOnly ? 'cm' : 'c')
    const compile = (filter?: string): CollectionMemberQuery => {
      const filtered = filter !== undefined && relationship !== undefined
      const child = compilePolymorphicQuery(this.#entities, target, {
        aliasPrefix: `${childAlias}_`,
        fields,
        limit: null,
        offset: 0,
        rawWhere: filtered
          ? this.#filteredCollectionCorrelation(plan, key, filter, childAlias)
          : this.#collectionCorrelation(plan, childAlias),
        rootAlias: childAlias,
        ...(filter === undefined || filtered ? {} : { where: filter }),
      })
      let query: SqlFragment = { sql: child.sql, values: child.values }
      if (projectedEdgeFields.length > 0) {
        query = SQL.compose([
          'SELECT "__child".*, ', this.#edgeProjection(plan, projectedEdgeFields),
          ' AS "__edge" FROM (', query, ') AS "__child"',
        ])
      }
      return {
        ...query,
        hydrate: row => {
          const hydrated = child.hydrate(row)
          const edge = row.__edge
          if (edge !== undefined && edge !== null && typeof edge === 'object') {
            Object.assign(hydrated, edge)
          }
          return Object.fromEntries(
            Object.entries(hydrated).filter(([name]) => !orderOnly.has(name)),
          )
        },
      }
    }
    return {
      compile,
      identity: ['id'],
      identityUnique: true,
      orderable: new Set([...fields, ...projectedEdgeFields]),
    }
  }

  /**
   * Build the physical member adapter for a relationship-record collection.
   * @param plan - Collection relation plan.
   * @param spec - Requested record fields.
   * @param countOnly - Whether only identity rows are required.
   * @returns The record member adapter.
   */
  #recordMember(
    plan: CollectionRelationPlan,
    spec: ProjectedCollectionSpec,
    countOnly = false,
  ): CollectionMemberAdapter {
    const relationship = plan.relationship
    if (relationship === undefined) {
      throw new Error(`Record collection "${plan.collection.name}" has no relationship source`)
    }
    const identity = relationship.between.map(endpoint => endpoint.field)
    const requested = countOnly
      ? new Set(identity)
      : new Set(recordFields(plan, spec.fields))
    const orderFields = countOnly ? [] : collectionOrderNames(plan, spec.orderBy)
    const fields = [...new Set([...requested, ...orderFields])]
    const orderOnly = new Set(orderFields.filter(name => !requested.has(name)))
    const selected = fields
      .map(field => `${recordColumn(plan, field)} AS ${quote(field)}`)
      .join(', ')
    const compile = (filter?: string): CollectionMemberQuery => {
      const where = filter === undefined ? undefined : this.#recordPredicate(plan, filter)
      const predicate = plan.predicate === undefined
        ? undefined
        : SQL.compose([' AND (', plan.predicate, ')'])
      const filterFragment = where === undefined || where.sql === ''
        ? undefined
        : { sql: where.sql.replace(/^WHERE\s+/u, ''), values: where.values }
      const filterSql = filterFragment === undefined
        ? undefined
        : SQL.compose([' AND (', filterFragment, ')'])
      const query = SQL.compose([
        `SELECT ${selected} FROM ${plan.relation} WHERE ${plan.condition}`,
        predicate,
        filterSql,
      ])
      return {
        ...query,
        hydrate: row => Object.fromEntries(
          Object.entries(row).filter(([name]) => !orderOnly.has(name)),
        ),
      }
    }
    return {
      compile,
      identity,
      identityUnique: true,
      orderable: new Set(fields),
    }
  }

  /**
   * Whether relationship-owned projection is unambiguous for one Entity collection.
   * @param plan - Collection relation plan.
   * @returns `true` when the owner/target pair is unique per edge.
   */
  #edgeProjectionAllowed(plan: CollectionRelationPlan): boolean {
    const collection = plan.collection
    if (collection.kind !== 'explicit') return true
    const relationship = collection.relationship
    if (relationship.between.length === 2) return true
    const target = collection.targetEndpoint
    if (!target) return false
    return relationship.constraints.some(constraint => (
      constraint.type === Constraint.Structural
      && constraint.fields.length === 2
      && constraint.fields.includes(collection.ownerEndpoint.field)
      && constraint.fields.includes(target.field)
    ))
  }

  /**
   * Build one correlated relationship-owned projection object.
   * @param plan - Collection relation plan.
   * @param fields - Relationship-owned property names.
   * @returns JSON object SQL with the owning row correlated as `__child`.
   */
  #edgeProjection(plan: CollectionRelationPlan, fields: readonly string[]): SqlFragment {
    const relationship = plan.relationship
    const relationshipAlias = plan.relationshipAlias
    const remote = plan.targetEndpoint
    if (relationship === undefined || relationshipAlias === undefined || remote === undefined) {
      throw new Error(`Collection "${plan.collection.name}" has no relationship projection`)
    }
    for (const field of fields) {
      if (!relationship.fields.some(candidate => candidate.name === field)) {
        throw new Error(
          `Entity collection "${plan.collection.name}" cannot project relationship endpoint ` +
          `"${field}"`,
        )
      }
    }
    const values = fields.map(field => (
      `${quoteLiteral(field)}, ${quote(relationshipAlias)}.${quote(field)}`
    ))
    const predicate = plan.predicate === undefined
      ? undefined
      : SQL.compose([' AND (', plan.predicate, ')'])
    return SQL.compose([
      '(SELECT json_build_object(', values.join(', '), ') FROM ', plan.relation,
      ' WHERE ', plan.condition, predicate, ' AND ',
      `${quote(relationshipAlias)}.${quote(`${remote.field}.id`)} = ` +
        `${quote('__child')}.${quote('id')})`,
    ])
  }

  /**
   * Select one computed scalar field from a parameterized fragment.
   * @param node - Projection occurrence.
   * @param name - Logical computed field name.
   * @param fragment - Parameterized SQL fragment.
   */
  #addComputedFragment(node: ProjectionNode, name: string, fragment: SqlFragment): void {
    if (node.fieldNames.has(name)) return
    const start = this.#valueStart + this.values.length
    const composed = SQL.compose([fragment], { startIndex: start })
    this.values.push(...composed.values)
    this.#addComputedScalar(node, name, `(${composed.sql})`)
  }

  /**
   * Select one computed scalar field.
   * @param node - Projection occurrence.
   * @param name - Logical computed field name.
   * @param expression - SQL expression.
   */
  #addComputedScalar(node: ProjectionNode, name: string, expression: string): void {
    if (node.fieldNames.has(name)) return
    const alias = columnAlias(node.path, name)
    this.columns.push(`${expression} AS ${quote(alias)}`)
    node.fields.push({ alias, name })
    node.fieldNames.add(name)
  }

  /**
   * Select one effective scalar field.
   * @param node - Projection occurrence.
   * @param name - Effective scalar field name.
   */
  #addScalar(node: ProjectionNode, name: string): void {
    if (node.fieldNames.has(name)) return
    if (node.identity && (name === 'id' || name === 'name' || name === 'entity')) return
    const field = node.context.effective.get(name)
    if (!field || field.type === FieldType.Entity) {
      throw new Error(`Unknown scalar field "${name}"`)
    }
    this.#consume()
    const alias = columnAlias(node.path, name)
    const expression = this.#expression(node.context, field, false)
    this.columns.push(`${expression} AS ${quote(alias)}`)
    node.fields.push({ alias, name })
    node.fieldNames.add(name)
  }

  /**
   * Select one descendant-only scalar field with nulls for absent leaves.
   * @param node - Projection occurrence.
   * @param field - Descendant field metadata.
   */
  #addDescendantScalar(node: ProjectionNode, field: DescendantField): void {
    if (node.fieldNames.has(field.name)) return
    this.#consume()
    this.#ensureRoot(node.context)
    const branches = field.variants.map(variant => {
      const owner = this.#ownerAlias(node.context, variant.owner, true)
      const leaves = variant.leaves.map(quoteLiteral).join(', ')
      return `WHEN ${node.context.rootAlias}.${quote('entity')} IN (${leaves}) ` +
        `THEN ${owner}.${quote(field.name)}`
    })
    const alias = columnAlias(node.path, field.name)
    this.columns.push(`CASE ${branches.join(' ')} ELSE NULL END AS ${quote(alias)}`)
    node.fields.push({ alias, name: field.name })
    node.fieldNames.add(field.name)
  }

  /**
   * Select the default identity for a reference target.
   * @param node - Reference target occurrence.
   */
  #identity(node: ProjectionNode): void {
    if (node.identity) return
    this.#consume(3)
    const prefix = node.path.join('__')
    const entity = `${prefix}__entity`
    const id = `${prefix}__id`
    const name = `${prefix}__name`
    this.columns.push(
      `${node.context.rootAlias}.${quote('entity')} AS ${quote(entity)}`,
      `${node.context.rootAlias}.${quote('id')} AS ${quote(id)}`,
      `${node.context.rootAlias}.${quote('name')} AS ${quote(name)}`,
    )
    node.identity = { entity, id, name }
  }

  /**
   * Render one effective scalar field expression.
   * @param context - Entity occurrence.
   * @param field - Effective field.
   * @param forceLeft - Whether an owner join must preserve absent rows.
   * @param useFilterOverride - Whether a pre-resolved filter expression takes precedence.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns Qualified SQL expression.
   */
  #expression(
    context: EntityContext,
    field: EffectiveFieldDefinition,
    forceLeft: boolean,
    useFilterOverride = true,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): string {
    const filtered = useFilterOverride ? this.#filterExpressions.get(field.name) : undefined
    if (filtered) return filtered
    if (field.name === 'id') return `${context.baseAlias}.${quote(field.name)}`
    if (field.owner === 'Entity') {
      return `${this.#ensureRoot(context, scope)}.${quote(field.name)}`
    }
    return `${this.#ownerAlias(context, field.owner, forceLeft, scope)}.${quote(field.name)}`
  }

  /**
   * Ensure a universal root join exists for one occurrence.
   * @param context - Entity occurrence.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns Root table alias.
   */
  #ensureRoot(
    context: EntityContext,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): string {
    if (context.rootOnly || context.rootJoined) return context.rootAlias
    const join = context.isTarget ? 'LEFT JOIN' : 'JOIN'
    scope.consume()
    scope.join(
      `${join} "Entity" "${context.rootAlias}" ON ` +
      `"${context.rootAlias}"."id" = "${context.baseAlias}"."id"`,
    )
    context.rootJoined = true
    return context.rootAlias
  }

  /**
   * Resolve or create a physical owner-table alias.
   * @param context - Entity occurrence.
   * @param owner - Physical owner table.
   * @param forceLeft - Whether the join must preserve absent rows.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns Owner table alias.
   */
  #ownerAlias(
    context: EntityContext,
    owner: string,
    forceLeft: boolean,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): string {
    if (owner === 'Entity') return this.#ensureRoot(context, scope)
    if (owner === context.definition.name) return context.baseAlias
    const existing = context.ownerAliases.get(owner)
    if (existing) return existing
    const alias = scope.alias('o')
    const join = context.isTarget || forceLeft ? 'LEFT JOIN' : 'JOIN'
    scope.consume()
    scope.join(
      `${join} "${owner}" "${alias}" ON "${alias}"."id" = "${context.baseAlias}"."id"`,
    )
    context.ownerAliases.set(owner, alias)
    return alias
  }

  /**
   * Create an empty projection occurrence.
   * @param context - Entity occurrence.
   * @param path - Reference path from the query root.
   * @returns Empty projection node.
   */
  #node(context: EntityContext, path: readonly string[]): ProjectionNode {
    return {
      context,
      fieldNames: new Set(),
      fields: [],
      path,
      projectedCollections: [],
      projectedSpecs: new Map(),
      referenceNames: new Map(),
      references: [],
    }
  }

  /**
   * Consume graph work and reject an over-budget projection.
   * @param units - Conservative physical work units.
   */
  #consume(units = 1): void {
    this.#work += units
    if (this.#work > this.#budget.work) {
      throw new Error(`Query projection exceeds the maximum graph work budget of ${this.#budget.work}`)
    }
  }

  /**
   * Allocate a unique table alias.
   * @param prefix - Alias prefix.
   * @returns Unique alias.
   */
  #nextAlias(prefix: string): string {
    this.#alias += 1
    return `${this.#aliasPrefix}${prefix}${this.#alias}`
  }
}

/**
 * Compile the full canonical record projection for one persisted identity.
 *
 * This internal boundary keeps the public query path/work budget unchanged
 * while allowing the mutation result to hydrate every canonical effective field.
 * @param entities - Canonical entity definitions.
 * @param definition - Concrete entity definition.
 * @param id - Canonical identity.
 * @returns The complete SQL, ordered bindings, and row hydrator.
 */
export function compileEntityRecordQuery(
  entities: EntityDefinitions,
  definition: EntityDefinition,
  id: string,
): CompiledPolymorphicQuery {
  const fields = definition.effectiveFields.map(field => field.name)
  return compilePolymorphicQuery(entities, definition, {
    fields,
    limit: 1,
    projectionBudget: {
      paths: fields.length,
      work: Number.MAX_SAFE_INTEGER,
    },
    where: { id },
  })
}

/**
 * Compile one entity query, including concrete/abstract effective fields,
 * descendant-only nullable fields, and singular reference projections.
 * @param entities - Canonical entity definitions.
 * @param definition - Concrete entity or abstract ancestor being queried.
 * @param options - Query options.
 * @returns The complete SQL, ordered bindings, and row hydrator.
 */
export function compilePolymorphicQuery(
  entities: EntityDefinitions,
  definition: EntityDefinition,
  options: PolymorphicQueryOptions,
): CompiledPolymorphicQuery {
  const projection = new QueryProjection(
    entities,
    definition,
    options.projectionBudget,
    options.rootAlias,
    options.aliasPrefix,
  )
  if (definition.abstract) projection.ensureRoot()
  const synthetic: EntityDefinition = { ...definition, fields: definition.effectiveFields }
  const field = (name: string): QueryFieldDefinition => {
    const value = projection.root.effective.get(name)
    if (!value) throw new Error(`Unknown field "${definition.name}.${name}"`)
    if (value.type === FieldType.Entity) {
      throw new Error(
        `Query field "${definition.name}.${name}" is an entity reference; ` +
        'references cannot be used in predicates or ordering',
      )
    }
    return value
  }
  const baseScope: QueryScope = {
    array: name => projection.arrayScope(name),
    collection: name => projection.collectionScope(name),
    definition: synthetic,
    expression: (value, bind) => projection.expression(value, bind),
    field,
    filterCount: name => projection.filterCount(name),
    filterField: name => projection.filterField(name),
    filterKind: name => projection.filterKind(name),
    orderField: name => projection.orderField(name),
  }
  const scope: QueryScope = baseScope
  const where = typeof options.where === 'string'
    ? QueryNormalizer.normalize(synthetic, options.where, scope.filterField, scope.collection, scope.array) ?? undefined
    : options.where
  const predicate = SQL.where(entities, definition.name, where, scope)
  let ordering = ''
  if (options.orderBy !== undefined) {
    ordering = SQL.orderBy(entities, definition.name, options.orderBy, scope).sql
    if (ordering !== '' && definition.abstract) ordering += `, ${projection.root.rootAlias}."id" ASC`
  }
  if (ordering === '' && definition.abstract) {
    ordering = `ORDER BY ${projection.root.rootAlias}."name" ASC, ` +
      `${projection.root.rootAlias}."id" ASC`
  }
  const rawStart = predicate.values.length + 1
  const rawSql = options.rawWhere === undefined
    ? undefined
    : SQL.compose([options.rawWhere], { startIndex: rawStart }).sql
  const rawValues = options.rawWhere?.values ?? []
  const hydrate = projection.build(options.fields, predicate.values.length + rawValues.length + 1)

  const leaves = definition.abstract
    ? entities.concreteDescendants(definition.name).map(entity => quoteLiteral(entity.name))
    : []
  const leafFilter = leaves.length === 0
    ? 'FALSE'
    : `${projection.root.rootAlias}."entity" IN (${leaves.join(', ')})`
  const conditions = [
    ...(definition.abstract ? [leafFilter] : []),
    ...(predicate.sql === '' ? [] : [predicate.sql.replace(/^WHERE /u, '')]),
    ...(rawSql === undefined ? [] : [rawSql]),
  ]
  const whereSql = conditions.length === 0
    ? ''
    : conditions.length === 1
      ? `WHERE ${conditions[0]}`
      : `WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}`
  const limit = options.limit === undefined ? 25 : options.limit
  const pagination = SQL.paginate(
    limit,
    options.offset ?? 0,
    predicate.values.length + rawValues.length + projection.values.length,
  )
  return {
    hydrate,
    sql: [
      `SELECT ${projection.columns.join(', ')}`,
      `FROM ${quote(definition.name)} "${projection.root.baseAlias}"`,
      ...projection.joins,
      whereSql,
      ordering,
      pagination.sql,
    ].filter(part => part !== '').join(' '),
    values: [...predicate.values, ...rawValues, ...projection.values, ...pagination.values],
  }
}

/**
 * Build an occurrence for the universal identity root.
 * @param entities - Canonical definitions.
 * @param rootAlias - Joined root table alias.
 * @returns Universal root occurrence with every concrete leaf field available.
 */
function rootContext(entities: EntityDefinitions, rootAlias: string): EntityContext {
  const definition = identityDefinition()
  return {
    baseAlias: rootAlias,
    collections: contextCollections(entities, definition),
    definition,
    descendants: universalDescendantFields(entities, definition),
    effective: new Map(definition.effectiveFields.map(field => [field.name, field])),
    isTarget: true,
    ownerAliases: new Map([['Entity', rootAlias]]),
    rootAlias,
    rootJoined: true,
    rootOnly: true,
    singularNavigations: new Map(
      entities.singularNavigations('Entity').map(navigation => [navigation.name, navigation]),
    ),
  }
}

/**
 * Build an occurrence for a non-root reference target.
 * @param entities - Canonical definitions.
 * @param definition - Target entity.
 * @param baseAlias - Joined target base table alias.
 * @param rootAlias - Joined target root table alias.
 * @returns Target occurrence.
 */
function targetContext(
  entities: EntityDefinitions,
  definition: EntityDefinition,
  baseAlias: string,
  rootAlias: string,
): EntityContext {
  return {
    baseAlias,
    collections: contextCollections(entities, definition),
    definition,
    descendants: descendantFields(entities, definition),
    effective: new Map(definition.effectiveFields.map(field => [field.name, field])),
    isTarget: true,
    ownerAliases: new Map([
      [definition.name, baseAlias],
      ['Entity', rootAlias],
    ]),
    rootAlias,
    rootJoined: true,
    rootOnly: false,
    singularNavigations: new Map(
      definition.singularNavigations.map(navigation => [navigation.name, navigation]),
    ),
  }
}

/**
 * Build the collection index for one occurrence, including descendant-only collections.
 * @param entities - Canonical definitions.
 * @param definition - Entity being queried.
 * @returns Collections keyed by logical name.
 */
function contextCollections(
  entities: EntityDefinitions,
  definition: EntityDefinition,
): ReadonlyMap<string, DerivedCollectionDefinition> {
  const result = new Map(definition.collections.map(collection => [collection.name, collection]))
  if (definition.abstract) {
    for (const leaf of entities.concreteDescendants(definition.name)) {
      for (const collection of entities.collections(leaf.name)) {
        if (!result.has(collection.name)) result.set(collection.name, collection)
      }
    }
  }
  return result
}

/** One parsed collection ordering entry. */
interface CollectionOrdering {
  /** Sort direction. */
  readonly direction: 'ASC' | 'DESC',
  /** Output alias to order by. */
  readonly name: string,
}

/**
 * Quote one alias-qualified identity tuple.
 * @param alias - Relation alias.
 * @param identity - Output aliases forming the identity.
 * @returns Comma-separated quoted columns.
 */
function identityColumns(alias: string, identity: readonly string[]): string {
  return identity.map(name => `${quote(alias)}.${quote(name)}`).join(', ')
}

/**
 * Count distinct result identities in one member query.
 * @param member - Member query before identity selection.
 * @param identity - Output aliases forming the identity.
 * @param unique - Whether member rows are already unique by identity.
 * @returns The count fragment.
 */
function collectionIdentityCount(
  member: SqlFragment,
  identity: readonly string[],
  unique: boolean,
): SqlFragment {
  if (unique) {
    return SQL.compose(['SELECT count(*)::int FROM (', member, ') AS "__member"'])
  }
  return SQL.compose([
    'SELECT count(*)::int FROM (SELECT DISTINCT ON (',
    identityColumns('__member', identity),
    ') * FROM (',
    member,
    ') AS "__member") AS "__distinct"',
  ])
}

/**
 * Select distinct identities after filtering, then order and page them.
 * @param member - Member query before identity selection.
 * @param identity - Output aliases forming the identity.
 * @param orderings - Requested and stable ordering.
 * @param limit - Page size, or null for unlimited.
 * @param offset - Rows to skip.
 * @param unique - Whether member rows are already unique by identity.
 * @returns The ordered and paged identity query.
 */
function collectionIdentityPage(
  member: SqlFragment,
  identity: readonly string[],
  orderings: readonly CollectionOrdering[],
  limit: number | null,
  offset: number,
  unique: boolean,
): SqlFragment {
  const order = orderings
    .map(entry => `${quote('__member')}.${quote(entry.name)} ${entry.direction}`)
    .join(', ')
  if (unique) {
    const paged = SQL.compose([
      'SELECT * FROM (', member, ') AS "__member"',
      order === '' ? undefined : ` ORDER BY ${order}`,
    ])
    return SQL.compose([paged, SQL.paginate(limit, offset, 0)])
  }
  const distinct = SQL.compose([
    'SELECT DISTINCT ON (', identityColumns('__member', identity), ') * FROM (',
    member,
    ') AS "__member" ORDER BY ', identityColumns('__member', identity),
  ])
  const distinctOrder = orderings
    .map(entry => `${quote('__distinct')}.${quote(entry.name)} ${entry.direction}`)
    .join(', ')
  const paged = SQL.compose([
    'SELECT * FROM (', distinct, ') AS "__distinct"',
    distinctOrder === '' ? undefined : ` ORDER BY ${distinctOrder}`,
  ])
  return SQL.compose([paged, SQL.paginate(limit, offset, 0)])
}

/**
 * Aggregate the paged identities into one JSON item array.
 * @param page - Ordered and paged identity query.
 * @param orderings - Requested and stable ordering.
 * @returns The JSON array fragment.
 */
function collectionItems(
  page: SqlFragment,
  orderings: readonly CollectionOrdering[],
): SqlFragment {
  const order = orderings
    .map(entry => `${quote('__item')}.${quote(entry.name)} ${entry.direction}`)
    .join(', ')
  return SQL.compose([
    'SELECT COALESCE(json_agg(row_to_json("__item")',
    order === '' ? undefined : SQL.compose([' ORDER BY ', order]),
    '), \'[]\'::json) FROM (',
    page,
    ') AS "__item"',
  ])
}

/**
 * Resolve collection ordering names with the identity as the stable tie-break.
 * @param plan - Collection relation plan.
 * @param orderBy - Requested ordering.
 * @returns Ordered output aliases.
 */
function collectionOrderNames(plan: CollectionRelationPlan, orderBy?: OrderBy): readonly string[] {
  return parseCollectionOrder(plan, orderBy).map(entry => entry.name)
}

/**
 * Resolve and validate collection ordering.
 * @param plan - Collection relation plan.
 * @param orderBy - Requested ordering.
 * @param adapter - Physical member adapter.
 * @returns Parsed ordering entries.
 */
function collectionOrderings(
  plan: CollectionRelationPlan,
  orderBy: OrderBy | undefined,
  adapter: CollectionMemberAdapter,
): readonly CollectionOrdering[] {
  const orderings = parseCollectionOrder(plan, orderBy)
  for (const entry of orderings) {
    if (!adapter.orderable.has(entry.name)) {
      throw new Error(`Unknown collection ordering field "${entry.name}"`)
    }
  }
  return orderings
}

/**
 * Parse one collection ordering with the identity as the stable tie-break.
 * @param plan - Collection relation plan.
 * @param orderBy - Requested ordering.
 * @returns Parsed ordering entries.
 */
function parseCollectionOrder(
  plan: CollectionRelationPlan,
  orderBy?: OrderBy,
): readonly CollectionOrdering[] {
  const identity = plan.resultType === 'record'
    ? plan.relationship?.between.map(endpoint => endpoint.field) ?? []
    : ['id']
  const requested = orderBy === undefined
    ? identity
    : Array.isArray(orderBy) ? [...orderBy] : [orderBy]
  const orderings: CollectionOrdering[] = requested.map(entry => {
    if (typeof entry === 'string') {
      const descending = entry.startsWith('-')
      return {
        direction: descending ? 'DESC' : 'ASC',
        name: descending ? entry.slice(1) : entry,
      }
    }
    return {
      direction: entry.direction === 'desc' ? 'DESC' : 'ASC',
      name: entry.field,
    }
  })
  for (const name of identity) {
    if (!orderings.some(entry => entry.name === name)) {
      orderings.push({ direction: 'ASC', name })
    }
  }
  return orderings
}

/**
 * Build the projection view for one relationship record.
 *
 * Endpoint columns are exposed as identity scalars so records project flat;
 * physical endpoint columns are resolved by the collection relation itself.
 * @param relationship - Named relationship providing the record shape.
 * @returns A synthetic entity view over the relationship row.
 */
function recordProjectionView(relationship: RelationshipDefinition): EntityDefinition {
  const fields: EffectiveFieldDefinition[] = [
    ...relationship.between.map(endpoint => ({
      name: endpoint.field,
      owner: relationship.name,
      type: FieldType.ID as const,
    })),
    ...relationship.fields.map(field => ({ ...field, owner: relationship.name })),
  ]
  return {
    abstract: false,
    collections: [],
    constraints: relationship.constraints,
    effectiveFields: fields,
    fields: fields as unknown as FieldDefinition[],
    inverseFields: [],
    name: relationship.name,
    parent: 'Entity',
    singularNavigations: [],
  }
}

/**
 * Resolve one record field to its physical SQL column.
 * @param plan - Record collection relation plan.
 * @param name - Logical endpoint or property name.
 * @returns The qualified SQL column.
 * @throws {Error} When the relationship does not declare the field.
 */
function recordColumn(plan: CollectionRelationPlan, name: string): string {
  const relationship = plan.relationship
  const alias = plan.relationshipAlias
  if (relationship === undefined || alias === undefined) {
    throw new Error(`Record collection "${plan.collection.name}" has no relationship source`)
  }
  const endpoint = relationship.between.find(candidate => candidate.field === name)
  if (endpoint !== undefined) return `${quote(alias)}.${quote(`${endpoint.field}.id`)}`
  if (!relationship.fields.some(field => field.name === name)) {
    throw new Error(`Unknown collection record field "${name}"`)
  }
  return `${quote(alias)}.${quote(name)}`
}

/**
 * Select the requested record fields, defaulting to the complete record.
 * @param plan - Record collection relation plan.
 * @param requested - Requested logical field names.
 * @returns Logical field names in output order.
 */
function recordFields(
  plan: CollectionRelationPlan,
  requested: ReadonlySet<string>,
): readonly string[] {
  const relationship = plan.relationship
  if (relationship === undefined) {
    throw new Error(`Record collection "${plan.collection.name}" has no relationship source`)
  }
  const available = [
    ...relationship.between.map(endpoint => endpoint.field),
    ...relationship.fields.map(field => field.name),
  ]
  if (requested.size === 0) return available
  const fields: string[] = []
  for (const name of requested) {
    if (name.includes('.')) {
      throw new Error(`Collection record field "${name}" cannot traverse a path`)
    }
    if (!available.includes(name)) throw new Error(`Unknown collection record field "${name}"`)
    if (!fields.includes(name)) fields.push(name)
  }
  return fields
}

/**
 * Build one dotted collection option key for a projection path.
 * @param path - Reference path from the query root.
 * @param name - Collection name.
 * @returns Collection option key.
 */
function collectionKey(path: readonly string[], name: string): string {
  return [...path.map(segment => segment.replace(/__v\d+$/u, '')), name].join('.')
}

/**
 * Resolve one flattened relationship-owned property.
 * @param entities - Canonical definitions.
 * @param collection - Relationship collection navigation.
 * @param name - Flattened property name.
 * @param path - Full requested path for diagnostics.
 * @returns The relationship property, or undefined when the name is target-owned.
 * @throws {Error} When the target and relationship both declare the same name.
 */
function relationshipProperty(
  entities: EntityDefinitions,
  collection: DerivedCollectionDefinition,
  name: string,
  path: string,
): QueryFieldDefinition | undefined {
  if (collection.kind === 'inverse') return undefined
  if (collection.kind === 'explicit' && collection.targetEndpoint === undefined) return undefined
  const relationship = collection.kind === 'relationship' || collection.kind === 'explicit'
    ? collection.relationship
    : undefined
  if (relationship === undefined) return undefined
  const property = relationship.fields.find(field => field.name === name)
  if (property === undefined) return undefined
  const target = collection.target === 'Entity'
    ? identityDefinition()
    : entities.entity(collection.target)
  if (target?.effectiveFields.some(field => field.name === name)) {
    throw new Error(
      `Ambiguous collection field "${path}": ${collection.target}.${name} and ` +
      `${relationship.name}.${name} both exist`,
    )
  }
  return property
}

/**
 * Build one flat SQL column alias for a projection path.
 * @param path - Reference path from the query root.
 * @param name - Field name.
 * @returns SQL column alias.
 */
function columnAlias(path: readonly string[], name: string): string {
  return path.length === 0 ? name : `${path.join('__')}__${name}`
}

/**
 * Hydrate one SQL row into the requested root projection.
 * @param row - Flat SQL row.
 * @param node - Root projection node.
 * @returns Nested projection result.
 */
function hydrateRoot(
  row: Record<string, unknown>,
  node: ProjectionNode,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of node.fields) result[field.name] = row[field.alias]
  for (const collection of node.projectedCollections) {
    result[collection.name] = collection.hydrate(row)
  }
  for (const reference of node.references) {
    result[reference.name] = hydrateReferenceVariants(row, reference)
  }
  return result
}

/**
 * Hydrate one reference, choosing the non-null variant when necessary.
 * @param row - Flat SQL row.
 * @param reference - Reference projection and its variant nodes.
 * @returns Nested identity and requested fields, or null for a missing reference.
 */
function hydrateReferenceVariants(
  row: Record<string, unknown>,
  reference: ReferenceProjection,
): Record<string, unknown> | null {
  for (const node of reference.nodes) {
    const value = hydrateReference(row, node)
    if (value !== null) return value
  }
  return null
}

/**
 * Hydrate one nested reference projection.
 * @param row - Flat SQL row.
 * @param node - Reference projection node.
 * @returns Nested identity and requested fields, or null for a missing reference.
 */
function hydrateReference(
  row: Record<string, unknown>,
  node: ProjectionNode,
): Record<string, unknown> | null {
  const identity = node.identity
  if (!identity) throw new Error('Reference projection is missing identity metadata')
  if (row[identity.id] === null || row[identity.id] === undefined) return null
  const result: Record<string, unknown> = {
    entity: row[identity.entity],
    id: row[identity.id],
    name: row[identity.name],
  }
  for (const field of node.fields) result[field.name] = row[field.alias]
  for (const collection of node.projectedCollections) {
    result[collection.name] = collection.hydrate(row)
  }
  for (const reference of node.references) {
    result[reference.name] = hydrateReferenceVariants(row, reference)
  }
  return result
}

/**
 * Lowercase only the first character of a relationship name.
 * @param value - Relationship name.
 * @returns Its nested result property name.
 */
function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`
}

/**
 * Quote a PostgreSQL identifier.
 * @param value - Identifier.
 * @returns Quoted identifier.
 */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Quote a PostgreSQL string literal.
 * @param value - Literal value.
 * @returns Quoted literal.
 */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
