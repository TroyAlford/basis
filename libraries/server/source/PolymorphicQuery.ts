import { collectionSqlRelation } from './CollectionSql'
import type { AssociationDefinition, DerivedCollectionDefinition, DerivedSingularDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'
import { resolveCollectionPath, resolveFieldPath } from './PathResolution'
import type { Filter } from './Predicate'
import { arrayItemField } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { ArrayScope, CollectionScope, CountScope, OrderBy, QueryScope } from './SQL'
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
  readonly rawWhere?: string,
  /**
   * Internal relationship metadata for flattened relationship-owned fields.
   * Only used by a collection child query.
   */
  readonly relationship?: {
    /** Correlated scalar expression for one relationship-owned field. */
    readonly expression: (field: string, targetAlias: string) => string,
    /** Scalar relationship-owned fields by flattened name. */
    readonly fields: ReadonlyMap<string, QueryFieldDefinition>,
    /** Relationship name used by explicit `membership.role` paths. */
    readonly name: string,
    /** Target effective field names that make a flattened path ambiguous. */
    readonly targetFields: ReadonlySet<string>,
  },
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
  /** Convert the JSON items into the `{ items, total }` envelope. */
  readonly hydrate: (row: Record<string, unknown>) => { items: unknown[], total: number },
  /** Output field name. */
  readonly name: string,
  /** SQL column alias carrying the full filtered count. */
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

/** One descendant-only field declaration group. */
interface DescendantField {
  /** Distinct canonical type/format/reference-target contracts. */
  readonly contracts: ReadonlySet<string>,
  /** Field name. */
  readonly name: string,
  /** Canonical field type shared by compatible declarations. */
  readonly type: FieldType,
  /** Owner/leaf variants that declare the field. */
  readonly variants: readonly DescendantVariant[],
}

/** One owner/contract group for a descendant-only field. */
interface DescendantVariant {
  /** Effective field declaration. */
  readonly field: EffectiveFieldDefinition,
  /** Concrete leaves that expose this declaration. */
  readonly leaves: readonly string[],
  /** Physical owner table. */
  readonly owner: string,
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
  /** Correlated condition against the owning occurrence. */
  readonly condition: string,
  /** Alias of the owning occurrence. */
  readonly parentAlias: string,
  /** Expression yielding the owning identity for grouped counts. */
  readonly parentId: string,
  /** Base SQL relation containing target rows. */
  readonly relation: string,
  /** Relationship table alias for relationship-owned properties. */
  readonly relationshipAlias?: string,
  /** Target universal-root alias. */
  readonly rootAlias: string,
  /** Target entity definition, absent for the universal root. */
  readonly target?: EntityDefinition,
  /** Physical target table alias, absent for the universal root. */
  readonly targetAlias?: string,
  /** Initial relation work emitted by this plan. */
  readonly work: number,
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
  /** Common table expressions required by count plans. */
  readonly ctes: string[] = []
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
  /** Filter-only resolved fields keyed by logical path. */
  readonly #filterFields = new Map<string, QueryFieldDefinition>()
  /** Reusable collection relation plans keyed by logical collection path. */
  readonly #collectionPlans = new Map<string, CollectionRelationPlan>()
  /** Collection predicate scopes keyed by root navigation name. */
  readonly #collectionScopes = new Map<string, CollectionScope>()
  /** Count expressions and existence forms keyed by logical count path. */
  readonly #countFields = new Map<string, CountScope>()
  /** Count CTE definitions keyed by physical count path. */
  readonly #countCtes = new Map<string, CountScope>()
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
   * @returns Physical SQL expression.
   */
  expression(field: QueryFieldDefinition): string {
    const count = this.#countFields.get(field.name)
    if (count) return count.expression
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
  ): { count?: CountScope, expression: string, field: QueryFieldDefinition, identity: boolean } {
    const [segment] = segments
    if (segment === undefined) throw new Error(`Invalid filter path "${fullName}"`)
    const rest = segments.slice(1)
    if (rest.length === 1 && rest[0] === '$count') {
      const collection = context.collections.get(segment)
      if (collection) {
        const key = fullName.slice(0, -7)
        const plan = this.#collectionPlan(collection, context.baseAlias, key)
        this.#consume(plan.work)
        const count = this.#collectionCountExpression(plan, `${fullName}\u0000${context.baseAlias}`)
        return {
          count,
          expression: '',
          field: { name: fullName, type: FieldType.Number },
          identity: false,
        }
      }
      const countField = context.effective.get(segment)
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
    const targetName = collection.target
    const target = targetName === 'Entity' ? undefined : this.#entities.entity(targetName)
    if (targetName !== 'Entity' && !target) throw new Error(`Unknown target entity "${targetName}"`)
    const targetAlias = targetName === 'Entity' ? undefined : this.#nextAlias('ct')
    const rootAlias = this.#nextAlias('cr')
    const relationship = collection.kind === 'relationship' ? collection.relationship : undefined
    const relationshipAlias = relationship ? this.#nextAlias('cj') : undefined
    const sql = collectionSqlRelation(collection, `"${parentAlias}".${quote('id')}`, {
      relationship: relationshipAlias ?? '',
      root: rootAlias,
      target: targetAlias ?? '',
    })
    const relation = sql.relation
    const condition = sql.condition
    let parentId: string
    if (collection.kind === 'inverse') {
      parentId = targetAlias === undefined
        ? `"${rootAlias}".${quote('id')}`
        : `"${targetAlias}".${quote(collection.reference.column)}`
    } else {
      parentId = `"${relationshipAlias as string}".${quote(
        `${relationship?.between[collection.endpoint].field as string}.id`,
      )}`
    }
    const plan: CollectionRelationPlan = {
      collection,
      condition,
      parentAlias,
      parentId,
      relation,
      relationshipAlias,
      rootAlias,
      target,
      targetAlias,
      work: collection.kind === 'inverse'
        ? targetAlias === undefined ? 1 : 2
        : targetAlias === undefined ? 2 : 3,
    }
    this.#collectionPlans.set(planKey, plan)
    return plan
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
    const resolved = resolveCollectionPath(context.definition, name, {
      resolve: value => this.#entities.entity(value),
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
    const prefix = resolveFieldPath(context.definition, resolved.prefix, {
      resolve: value => this.#entities.entity(value),
    })
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
   * @param resolved - Resolved collection and its parent occurrence.
   * @param resolved.collection - Collection navigation.
   * @param resolved.context - Occurrence owning the collection.
   * @param resolved.parentAlias - Alias of the occurrence owning the collection.
   * @param name - Stable logical collection path.
   * @param root - Whether this is a root-level collection.
   * @returns The collection scope.
   */
  #scopeForCollection(
    resolved: { collection: DerivedCollectionDefinition, context: EntityContext, parentAlias: string },
    name: string,
    root: boolean,
  ): CollectionScope {
    const plan = this.#collectionPlan(resolved.collection, resolved.parentAlias, name)
    this.#consume(plan.work)
    const relationship = plan.collection.kind === 'relationship' ? plan.collection.relationship : undefined
    const relationshipAlias = plan.relationshipAlias
    const condition = plan.condition
    if (root) {
      this.#countFields.set(
        `${name}.$count`,
        this.#collectionCountExpression(plan, `${name}.$count\u0000${resolved.parentAlias}`),
      )
    }
    const context: EntityContext = plan.target === undefined
      ? rootContext(this.#entities, plan.rootAlias)
      : targetContext(this.#entities, plan.target, plan.targetAlias as string, plan.rootAlias)
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
          const propertyName = path.slice(prefix.length)
          const property = relationship.fields.find(candidate => candidate.name === propertyName)
          if (!property) {
            throw new Error(`Unknown relationship field "${relationship.name}.${propertyName}"`)
          }
          if (property.type === FieldType.Array || property.type === FieldType.JSON) {
            throw new Error(
              `Relationship field "${relationship.name}.${propertyName}" is not a scalar property`,
            )
          }
          const field: QueryFieldDefinition = { ...property, name: path }
          resolvedFields.set(path, field)
          expressions.set(path, `"${relationshipAlias}".${quote(property.name)}`)
          return field
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
      definition: plan.target ?? identityDefinition(),
      expression: field => {
        const expression = expressions.get(field.name)
        if (!expression) throw new Error(`Unresolved collection field "${field.name}"`)
        return expression
      },
      field: resolve,
      filterKind: path => (identities.has(path) ? 'identity' : undefined),
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
    const cached = this.#countCtes.get(key)
    if (cached) return cached
    let expression: string | undefined
    const ensureCte = (): string => {
      if (expression) return expression
      const cteName = this.#nextAlias('cc')
      const joinAlias = this.#nextAlias('c')
      this.ctes.push(
        `"${cteName}" AS (` +
        `SELECT ${plan.parentId} AS "parent_id", count(*)::int AS "total" ` +
        `FROM ${plan.relation} GROUP BY ${plan.parentId})`,
      )
      this.joins.push(
        `LEFT JOIN "${cteName}" "${joinAlias}" ` +
        `ON "${joinAlias}"."parent_id" = "${plan.parentAlias}".${quote('id')}`,
      )
      expression = `COALESCE("${joinAlias}"."total", 0)`
      return expression
    }
    const count: CountScope = {
      empty: `NOT EXISTS (SELECT 1 FROM ${plan.relation} WHERE ${plan.condition})`,
      exists: `EXISTS (SELECT 1 FROM ${plan.relation} WHERE ${plan.condition})`,
      get expression() { return ensureCte() },
    }
    this.#countCtes.set(key, count)
    return count
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
    if (name.endsWith('.$count')) return this.filterField(name)
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
    const segments = name.split('.')
    if (segments.some(segment => segment.length === 0)) {
      throw new Error(`Invalid filter path "${name}"`)
    }
    const resolved = this.#resolveFilterPath(this.root, segments, name, '', 0)
    if (resolved.count) this.#countFields.set(name, resolved.count)
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
    if (rest.length === 1 && rest[0] === '$count') {
      const collection = node.context.collections.get(name)
      if (collection) {
        const key = collectionKey(node.path, collection.name)
        const plan = this.#collectionPlan(collection, node.context.baseAlias, key)
        this.#consume(plan.work)
        const count = this.#collectionCountExpression(plan, `${path}\u0000${node.context.baseAlias}`)
        this.#addComputedScalar(node, `${name}.$count`, count.expression)
        return
      }
      const field = node.context.effective.get(name)
      if (field?.type === FieldType.Array) {
        this.#consume()
        const expression = this.#expression(node.context, field, false)
        this.#addComputedScalar(node, `${name}.$count`, `COALESCE(cardinality(${expression}), 0)`)
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
      if (collection.kind === 'relationship') {
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
   * Add one root collection envelope projection.
   * @param node - Projection occurrence.
   * @param collection - Derived collection navigation.
   */
  /**
   * Add one projected collection as a correlated child query.
   * @param node - Projection occurrence owning the collection.
   * @param spec - Requested target and edge fields.
   */
  #addProjectedCollection(node: ProjectionNode, spec: ProjectedCollectionSpec): void {
    const key = collectionKey(node.path, spec.collection.name)
    const plan = this.#collectionPlan(spec.collection, node.context.baseAlias, key)
    this.#consume(plan.work)
    const target = spec.collection.target === 'Entity'
      ? identityDefinition()
      : this.#entities.entity(spec.collection.target)
    if (!target) throw new Error(`Unknown target entity "${spec.collection.target}"`)
    const limit = spec.limit === undefined ? 3 : spec.limit
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error(`Collection "${key}" $limit must be a non-negative integer or null`)
    }
    const offset = spec.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Collection "${key}" $offset must be a non-negative integer`)
    }
    const requestedOrder = spec.orderBy === undefined
      ? ['id']
      : Array.isArray(spec.orderBy) ? [...spec.orderBy] : [spec.orderBy]
    const orderings = requestedOrder.map(entry => {
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
    if (!orderings.some(order => order.name === 'id')) {
      orderings.push({ direction: 'ASC', name: 'id' })
    }
    const projectedFields = new Set(['id', 'name', 'entity', ...spec.fields])
    const orderOnlyFields = new Set(orderings
      .map(order => order.name)
      .filter(name => !projectedFields.has(name)))
    const filter = spec.filters.size === 0
      ? undefined
      : [...spec.filters].map(value => `(${value})`).join(' $and ')
    const relationship = spec.collection.kind === 'relationship' ? spec.collection.relationship : undefined
    const endpoint = spec.collection.kind === 'relationship' ? spec.collection.endpoint : 0
    const relationshipAlias = plan.relationshipAlias
    let relationshipOptions: NonNullable<PolymorphicQueryOptions['relationship']> | undefined
    if (relationship !== undefined && relationshipAlias !== undefined) {
      relationshipOptions = {
        expression: (field: string, targetAlias: string): string => {
          const prefix = `${lowerFirst(relationship.name)}.`
          const property = field.startsWith(prefix) ? field.slice(prefix.length) : field
          const remote = relationship.between[endpoint === 0 ? 1 : 0]
          return `(SELECT ${quote(relationshipAlias)}.${quote(property)} FROM ${plan.relation} ` +
            `WHERE ${plan.condition} AND ${quote(relationshipAlias)}.${quote(`${remote.field}.id`)} = ` +
            `${quote(targetAlias)}.${quote('id')})`
        },
        fields: new Map(relationship.fields
          .filter(field => field.type !== FieldType.Array && field.type !== FieldType.JSON)
          .map(field => [field.name, field])),
        name: relationship.name,
        targetFields: new Set(target.effectiveFields.map(field => field.name)),
      }
    }
    const childAlias = this.#nextAlias('c')
    const child = compilePolymorphicQuery(this.#entities, target, {
      aliasPrefix: `${childAlias}_`,
      fields: [...new Set([
        'id',
        'name',
        'entity',
        ...spec.fields,
        ...orderings.map(order => order.name),
      ])],
      limit: null,
      offset: 0,
      orderBy: orderings.map(order => (order.direction === 'DESC' ? `-${order.name}` : order.name)),
      rawWhere:
        `EXISTS (SELECT 1 FROM ${plan.relation} WHERE ${plan.condition} ` +
        `AND ${quote(plan.rootAlias)}.${quote('id')} = ${quote(childAlias)}.${quote('id')})`,
      ...(relationshipOptions === undefined ? {} : { relationship: relationshipOptions }),
      rootAlias: childAlias,
      ...(filter === undefined ? {} : { where: filter }),
    })
    const base = this.#valueStart + this.values.length
    const childSql = child.sql.replace(/\$(\d+)\b/gu, (_match, value: string) => (
      `$${base + Number(value) - 1}`
    ))
    this.values.push(...child.values)

    const edgeFields = [...spec.edgeFields]
    const edgeObject = edgeFields.length === 0
      ? 'NULL'
      : `(SELECT json_build_object(${edgeFields.map(field => (
        `${quoteLiteral(field)}, ${quote(plan.relationshipAlias as string)}.${quote(field)}`
      )).join(', ')}) ` +
      `FROM ${plan.relation} WHERE ${plan.condition} ` +
      `AND ${quote(plan.rootAlias)}.${quote('id')} = "__item".${quote('id')})`
    const alias = columnAlias(node.path, spec.collection.name)
    const totalAlias = `${alias}__total`
    const lateralAlias = this.#nextAlias('pc')
    const page = [
      ...(limit === null ? [] : [`LIMIT ${limit}`]),
      ...(limit === null && offset === 0 ? [] : [`OFFSET ${offset}`]),
    ].join(' ')
    const aggregateOrder = orderings
      .map(order => `${quote('__item')}.${quote(order.name)} ${order.direction}`)
      .join(', ')
    this.joins.push(
      'LEFT JOIN LATERAL (SELECT ' +
      'COALESCE((SELECT json_agg(json_build_object(\'item\', row_to_json("__item"), ' +
      `'edge', ${edgeObject}) ORDER BY ${aggregateOrder}) ` +
      `FROM (${childSql}${page === '' ? '' : ` ${page}`}) AS "__item"), ` +
      '\'[]\'::json) AS "__items", ' +
      `(SELECT count(*) FROM (${childSql}) AS "__count") AS "__total"` +
      `) AS ${quote(lateralAlias)} ON TRUE`,
    )
    this.columns.push(
      `${quote(lateralAlias)}.${quote('__items')} AS ${quote(alias)}`,
      `${quote(lateralAlias)}.${quote('__total')} AS ${quote(totalAlias)}`,
    )
    node.projectedCollections.push({
      alias,
      hydrate: row => {
        const raw = row[alias]
        const entries = Array.isArray(raw)
          ? raw
          : typeof raw === 'string'
            ? JSON.parse(raw) as unknown[]
            : []
        return {
          items: entries.map(entry => {
            const record = entry as {
              readonly edge?: Record<string, unknown> | null,
              readonly item: Record<string, unknown>,
            }
            const hydrated = child.hydrate(record.item)
            const merged = record.edge === undefined || record.edge === null
              ? hydrated
              : { ...hydrated, ...record.edge }
            return Object.fromEntries(
              Object.entries(merged).filter(([field]) => !orderOnlyFields.has(field)),
            )
          }),
          total: Number(row[totalAlias] ?? 0),
        }
      },
      name: spec.collection.name,
      totalAlias,
    })
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
    expression: value => projection.expression(value),
    field,
    filterCount: name => projection.filterCount(name),
    filterField: name => projection.filterField(name),
    filterKind: name => projection.filterKind(name),
    orderField: name => projection.orderField(name),
  }
  const relationship = options.relationship
  const relationshipPrefix = relationship === undefined
    ? ''
    : `${lowerFirst(relationship.name)}.`
  const resolveRelationship = (name: string): QueryFieldDefinition | undefined => {
    if (relationship === undefined) return undefined
    if (name.startsWith(relationshipPrefix)) {
      const property = relationship.fields.get(name.slice(relationshipPrefix.length))
      if (property === undefined) throw new Error(`Unknown relationship field "${name}"`)
      return { ...property, name }
    }
    const property = relationship.fields.get(name)
    if (property === undefined) return undefined
    if (relationship.targetFields.has(name)) {
      throw new Error(
        `Ambiguous collection field "${name}": target.${name} and ` +
        `${relationship.name}.${name} both exist`,
      )
    }
    return property
  }
  const scope: QueryScope = relationship === undefined ? baseScope : {
    ...baseScope,
    expression: value => {
      if (value.name.startsWith(relationshipPrefix)
        || (relationship.fields.has(value.name) && !relationship.targetFields.has(value.name))) {
        return relationship.expression(value.name, projection.root.baseAlias)
      }
      return baseScope.expression(value)
    },
    filterField: name => resolveRelationship(name) ?? baseScope.filterField?.(name) ?? baseScope.field(name),
  }
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
  const hydrate = projection.build(options.fields, predicate.values.length + 1)

  const leaves = definition.abstract
    ? entities.concreteDescendants(definition.name).map(entity => quoteLiteral(entity.name))
    : []
  const leafFilter = leaves.length === 0
    ? 'FALSE'
    : `${projection.root.rootAlias}."entity" IN (${leaves.join(', ')})`
  const conditions = [
    ...(definition.abstract ? [leafFilter] : []),
    ...(predicate.sql === '' ? [] : [predicate.sql.replace(/^WHERE /u, '')]),
    ...(options.rawWhere === undefined ? [] : [options.rawWhere]),
  ]
  const whereSql = conditions.length === 0
    ? ''
    : conditions.length === 1
      ? `WHERE ${conditions[0]}`
      : `WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}`
  const limit = options.limit === undefined ? 25 : options.limit
  const pagination = SQL.paginate(limit, options.offset ?? 0, predicate.values.length + projection.values.length)
  return {
    hydrate,
    sql: [
      ...(projection.ctes.length === 0 ? [] : [`WITH ${projection.ctes.join(', ')}`]),
      `SELECT ${projection.columns.join(', ')}`,
      `FROM ${quote(definition.name)} "${projection.root.baseAlias}"`,
      ...projection.joins,
      whereSql,
      ordering,
      pagination.sql,
    ].filter(part => part !== '').join(' '),
    values: [...predicate.values, ...projection.values, ...pagination.values],
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

/**
 * Build the descendant-only field index for one abstract entity.
 * @param entities - Canonical definitions.
 * @param definition - Entity being queried.
 * @returns Descendant fields keyed by logical name.
 */
function descendantFields(
  entities: EntityDefinitions,
  definition: EntityDefinition,
): ReadonlyMap<string, DescendantField> {
  if (!definition.abstract) return new Map()
  const baseNames = new Set(definition.effectiveFields.map(field => field.name))
  const leaves = entities.concreteDescendants(definition.name)
  return collectDescendantFields(leaves, baseNames)
}

/**
 * Build the selectable descendant union for the universal `Entity` root.
 * @param entities - Canonical definitions.
 * @param root - Canonical universal root definition.
 * @returns Leaf-owned fields keyed by logical name.
 */
function universalDescendantFields(
  entities: EntityDefinitions,
  root: EntityDefinition,
): ReadonlyMap<string, DescendantField> {
  const leaves = entities.concreteDescendants('Entity')
  return collectDescendantFields(leaves, new Set(root.effectiveFields.map(field => field.name)))
}

/**
 * Group leaf-owned fields into compatible descendant variants.
 * @param leaves - Concrete entities in canonical order.
 * @param baseNames - Field names already supplied by the base/root occurrence.
 * @returns Descendant fields keyed by logical name.
 */
function collectDescendantFields(
  leaves: readonly EntityDefinition[],
  baseNames: ReadonlySet<string>,
): ReadonlyMap<string, DescendantField> {
  const groups = new Map<string, Map<string, {
    readonly field: EffectiveFieldDefinition,
    readonly leaves: Set<string>,
  }>>()

  for (const leaf of leaves) {
    for (const field of leaf.effectiveFields) {
      if (baseNames.has(field.name)) continue
      let variants = groups.get(field.name)
      if (!variants) {
        variants = new Map()
        groups.set(field.name, variants)
      }
      const key = `${field.owner}\u0000${fieldContract(field)}`
      let variant = variants.get(key)
      if (!variant) {
        variant = { field, leaves: new Set() }
        variants.set(key, variant)
      }
      variant.leaves.add(leaf.name)
    }
  }

  const result = new Map<string, DescendantField>()
  for (const [name, variants] of groups) {
    const values = [...variants.values()]
    const contracts = new Set(values.map(variant => fieldContract(variant.field)))
    result.set(name, {
      contracts,
      name,
      type: values[0]?.field.type ?? FieldType.String,
      variants: values.map(variant => ({
        field: variant.field,
        leaves: [...variant.leaves],
        owner: variant.field.owner,
      })),
    })
  }
  return result
}

/**
 * Build one canonical contract signature for descendant compatibility.
 * @param field - Field declaration.
 * @returns Type/format/reference-target signature.
 */
function fieldContract(field: FieldDefinition): string {
  if (field.type === FieldType.JSON) return 'JSON'
  if (field.type === FieldType.Enum) return `Enum:${field.enum}`
  if (field.type === FieldType.Array) {
    return `Array:${field.items.type}:${field.items.format ?? ''}`
  }
  if (field.type === FieldType.Entity) return `Entity:${field.target}`
  if (field.type === FieldType.Inverse) return `Inverse:${field.target}:${field.inverse}:${field.cardinality}`
  return `${field.type}:${field.format ?? ''}`
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
  if (collection.kind !== 'relationship') return undefined
  const property = collection.relationship.fields.find(field => field.name === name)
  if (property === undefined) return undefined
  const target = collection.target === 'Entity'
    ? identityDefinition()
    : entities.entity(collection.target)
  if (target?.effectiveFields.some(field => field.name === name)) {
    throw new Error(
      `Ambiguous collection field "${path}": ${collection.target}.${name} and ` +
      `${collection.relationship.name}.${name} both exist`,
    )
  }
  return property
}

/** Parsed collection-context directives on one path segment. */
interface CollectionDirectives {
  /** Collection filter, relative to each item. */
  readonly filter?: string,
  /** Requested page size; `null` means unlimited. */
  readonly limit?: number | null,
  /** Base collection field name. */
  readonly name: string,
  /** Requested page offset. */
  readonly offset?: number,
  /** Requested item ordering. */
  readonly orderBy?: OrderBy,
}

/**
 * Split a string on one delimiter outside brackets, braces and quoted strings.
 * @param value - Source text.
 * @param delimiter - Delimiter character.
 * @returns Trimmed, non-empty pieces.
 */
function splitTopLevel(value: string, delimiter: string): readonly string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quoteCharacter: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quoteCharacter !== null) {
      current += character
      if (character === '\\') {
        index += 1
        current += value[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      current += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      current += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      current += character
      continue
    }
    if (character === delimiter && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (quoteCharacter !== null || depth !== 0) throw new Error(`Unbalanced collection directive "${value}"`)
  parts.push(current.trim())
  return parts.filter(part => part !== '')
}

/**
 * Read one balanced bracket or brace group.
 * @param segment - Full path segment.
 * @param start - Opening delimiter index.
 * @param open - Opening delimiter.
 * @param close - Closing delimiter.
 * @returns The content and the index just after the group.
 */
function readGroup(
  segment: string,
  start: number,
  open: string,
  close: string,
): { readonly content: string, readonly next: number } {
  let depth = 1
  let quoteCharacter: string | null = null
  let content = ''
  let index = start + 1
  for (; index < segment.length && depth > 0; index += 1) {
    const character = segment[index] as string
    if (quoteCharacter !== null) {
      content += character
      if (character === '\\') {
        index += 1
        content += segment[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      content += character
      continue
    }
    if (character === open) {
      depth += 1
      content += character
      continue
    }
    if (character === close) {
      depth -= 1
      if (depth === 0) break
      content += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      content += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      content += character
      continue
    }
    content += character
  }
  if (depth !== 0 || quoteCharacter !== null) throw new Error(`Unbalanced collection path "${segment}"`)
  return { content: content.trim(), next: index + 1 }
}

/**
 * Parse one compact `$orderBy` value.
 * @param value - Option value.
 * @returns Existing orderBy contract values.
 */
function parseOrderByValue(value: string): OrderBy {
  if (value.startsWith('[') && value.endsWith(']')) {
    const fields = splitTopLevel(value.slice(1, -1), ',')
    if (fields.length === 0) throw new Error('Collection $orderBy array must not be empty')
    return fields.map(field => parseOrderByField(field)) as readonly string[]
  }
  return parseOrderByField(value)
}

/**
 * Parse one short orderBy field.
 * @param value - Field text.
 * @returns Field or `-field` shorthand.
 */
function parseOrderByField(value: string): string {
  const field = value.trim()
  if (field === '') throw new Error('Collection $orderBy field must not be empty')
  if (field.startsWith('--')) throw new Error('Collection $orderBy uses one leading "-" for descending')
  return field
}

/**
 * Parse one compact options group.
 * @param content - Group content.
 * @returns Parsed options.
 */
function parseCollectionOptions(content: string): Pick<CollectionDirectives, 'limit' | 'offset' | 'orderBy'> {
  const options: { limit?: number | null, offset?: number, orderBy?: OrderBy } = {}
  const seen = new Set<string>()
  for (const entry of splitTopLevel(content, ',')) {
    const separator = entry.indexOf(':')
    if (separator === -1) throw new Error(`Collection option "${entry}" must be a key:value pair`)
    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (seen.has(key)) throw new Error(`Collection option "${key}" is repeated`)
    seen.add(key)
    if (key === '$limit') {
      if (value === 'null') {
        options.limit = null
      } else if (/^\d+$/u.test(value)) {
        options.limit = Number(value)
      } else {
        throw new Error('Collection $limit must be a non-negative integer or null')
      }
    } else if (key === '$offset') {
      if (!/^\d+$/u.test(value)) throw new Error('Collection $offset must be a non-negative integer')
      options.offset = Number(value)
    } else if (key === '$orderBy') {
      options.orderBy = parseOrderByValue(value)
    } else {
      throw new Error(`Unknown collection option "${key}"`)
    }
  }
  return options
}

/**
 * Split one field path without splitting dots inside directive groups or quoted strings.
 * @param value - Requested field path.
 * @returns Path segments.
 */
function splitFieldPath(value: string): readonly string[] {
  const segments: string[] = []
  let current = ''
  let depth = 0
  let quoteCharacter: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quoteCharacter !== null) {
      current += character
      if (character === '\\') {
        index += 1
        current += value[index] ?? ''
      } else if (character === quoteCharacter) {
        quoteCharacter = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quoteCharacter = character
      current += character
      continue
    }
    if (character === '[' || character === '{') {
      depth += 1
      current += character
      continue
    }
    if (character === ']' || character === '}') {
      depth -= 1
      current += character
      continue
    }
    if (character === '.' && depth === 0) {
      segments.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (quoteCharacter !== null || depth !== 0) throw new Error(`Unbalanced collection path "${value}"`)
  segments.push(current)
  return segments
}

/**
 * Parse collection filter, options and `$orderBy` from one path segment.
 * Filter group `[...]` must precede options group `{...}`.
 * @param segment - One requested field-path segment.
 * @returns The base name and its directives.
 */
function parseCollectionDirectives(segment: string): CollectionDirectives {
  const bracket = segment.indexOf('[')
  const brace = segment.indexOf('{')
  const open = bracket === -1 ? brace : brace === -1 ? bracket : Math.min(bracket, brace)
  if (open === -1) return { name: segment }
  const name = segment.slice(0, open)
  if (name === '') throw new Error(`Collection path "${segment}" has no field name`)
  let index = open
  let filter: string | undefined
  let options: Pick<CollectionDirectives, 'limit' | 'offset' | 'orderBy'> = {}
  if (segment[index] === '[') {
    const group = readGroup(segment, index, '[', ']')
    filter = group.content
    if (filter === '') throw new Error(`Collection filter in "${segment}" is empty`)
    index = group.next
  }
  if (segment[index] === '{') {
    const group = readGroup(segment, index, '{', '}')
    options = parseCollectionOptions(group.content)
    index = group.next
  } else if (segment[index] === '[') {
    throw new Error(`Collection filters must be specified once in "${segment}"`)
  }
  if (index !== segment.length) {
    throw new Error(`Collection options must precede filters and appear once in "${segment}"`)
  }
  return { filter, name, ...options }
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
