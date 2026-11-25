import { resolveCollectionRelation } from './CollectionRelation'
import { collectionSqlRelation } from './CollectionSql'
import type { AssociationDefinition, DerivedCollectionDefinition, DerivedSingularDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, QueryFieldDefinition, RelationshipDefinition, RelationshipEndpointDefinition } from './EntityDefinitions'
import { Constraint, FieldType, identityDefinition, logicalFieldContract } from './EntityDefinitions'
import type { PathFailure, PhysicalPathVariant, ResolvedPredicatePath } from './PathResolution'
import { resolvePredicatePath } from './PathResolution'
import { parseCollectionDirectives, splitFieldPath } from './PathSyntax'
import type { Filter } from './Predicate'
import { arrayItemField, Predicate } from './Predicate'
import { PredicateEligibility } from './PredicateEligibility'
import { QueryNormalizer } from './QueryNormalizer'
import type { ArrayScope, BoundScalar, CollectionScope, CountScope, OrderBy, QueryScope, SqlFragment, SQLPredicate } from './SQL'
import { SQL, sqlConcat, sqlFragment, sqlText, sqlValue } from './SQL'

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
  /** Internal CTE namespace for nested compiler scopes. */
  readonly relationPrefix?: string,
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
  join(sql: SqlFragment | string): void,
}

/** One canonical physical path branch with its SQL occurrence aliases. */
interface CanonicalFilterBranch {
  /** Occurrence owning the terminal field or collection. */
  readonly context: EntityContext,
  /** Physical occurrences keyed by logical reference prefix. */
  readonly occurrences: ReadonlyMap<string, string>,
  /** Canonical physical sequence and restrictions. */
  readonly variant: PhysicalPathVariant,
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

/** One field required from an authorized entity relation. */
interface AuthorizedField {
  /** Stable output alias used by the outer query. */
  readonly alias: string,
  /** Effective field metadata. */
  readonly field: EffectiveFieldDefinition,
}

/**
 * Plan leaf-rooted authorized relations from Graph field requirements.
 *
 * Requirements are registered while the existing resolver walks fields,
 * references, filters and collections. SQL is emitted only after all
 * requirements are known; no finished statement is parsed or rewritten.
 */
class AuthorizedRelations {
  /** Concrete and abstract entity relations keyed by entity name. */
  readonly #relations = new Map<string, Map<string, AuthorizedField | null>>()
  /** Canonical entity definitions. */
  readonly #entities: EntityDefinitions
  /** Prefix that prevents nested compiler CTEs from shadowing outer relations. */
  readonly #prefix: string

  /**
   * Create one relation planner for a query compilation.
   * @param entities - Canonical entity definitions.
   * @param prefix - Nested compiler CTE prefix.
   */
  constructor(entities: EntityDefinitions, prefix = '') {
    this.#entities = entities
    this.#prefix = prefix
  }

  /**
   * Require one entity relation and return its stable SQL name.
   * @param name - Entity name.
   * @returns Quoted authorized relation name.
   */
  relation(name: string): string {
    this.#ensure(name)
    return quote(this.relationName(name))
  }

  /**
   * Resolve one authorized relation identifier without quoting.
   * @param name - Entity name.
   * @returns Stable relation identifier.
   */
  relationName(name: string): string {
    this.#ensure(name)
    return `authorized_${this.#prefix}${name}`
  }

  /**
   * Register one effective field required from an entity relation.
   * @param definition - Entity occurrence definition.
   * @param field - Effective field accessed by the compiler.
   */
  register(definition: EntityDefinition, field: EffectiveFieldDefinition): void {
    const alias = fieldAlias(field)
    const fields = this.#ensure(definition.name)
    fields.set(alias, { alias, field })
    if (definition.abstract) {
      for (const leaf of this.#entities.concreteDescendants(definition.name)) {
        const leafFields = this.#ensure(leaf.name)
        const available = leaf.effectiveFields.find(candidate => fieldAlias(candidate) === alias)
        leafFields.set(alias, available === undefined
          ? null
          : { alias, field: available })
      }
    }
  }

  /**
   * Register an output alias without an already resolved field.
   * @param name - Entity name.
   * @param alias - Required output alias.
   */
  registerAlias(name: string, alias: string): void {
    const definition = name === 'Entity' ? identityDefinition() : this.#entities.entity(name)
    if (!definition) throw new Error(`Unknown entity "${name}"`)
    const field = definition.effectiveFields.find(candidate => fieldAlias(candidate) === alias)
    if (field !== undefined) {
      this.register(definition, field)
      return
    }
    this.#ensure(name).set(alias, null)
    if (definition.abstract) {
      for (const leaf of this.#entities.concreteDescendants(name)) {
        const leafField = leaf.effectiveFields.find(candidate => fieldAlias(candidate) === alias)
        this.#ensure(leaf.name).set(alias, leafField === undefined ? null : { alias, field: leafField })
      }
    }
  }

  /**
   * Require the universal identity columns for one occurrence.
   * @param definition - Entity occurrence definition.
   */
  registerIdentity(definition: EntityDefinition): void {
    for (const alias of ['id', 'name', 'entity']) this.registerAlias(definition.name, alias)
  }

  /**
   * Emit reusable CTE definitions in dependency order.
   * @returns Quoted CTE definitions, or an empty array.
   */
  definitions(): string[] {
    for (const [name, required] of [...this.#relations]) {
      const definition = name === 'Entity' ? identityDefinition() : this.#entities.entity(name)
      if (!definition || (name !== 'Entity' && !definition.abstract)) continue
      for (const leaf of this.#entities.concreteDescendants(name)) {
        const leafFields = this.#ensure(leaf.name)
        for (const alias of required.keys()) {
          if (leafFields.has(alias)) continue
          const field = leaf.effectiveFields.find(candidate => fieldAlias(candidate) === alias)
          leafFields.set(alias, field === undefined ? null : { alias, field })
        }
      }
    }
    const names = [...this.#relations.keys()]
    const concrete = names.filter(name => {
      if (name === 'Entity') return false
      const definition = this.#entities.entity(name)
      return definition !== undefined && !definition.abstract
    })
    const abstract = names.filter(name => !concrete.includes(name))
    return [
      ...concrete.map(name => this.#concreteDefinition(name)),
      ...abstract.map(name => this.#abstractDefinition(name)),
    ].filter(definition => definition !== '')
  }

  /**
   * Ensure one relation requirement bucket exists.
   * @param name - Entity name.
   * @returns Mutable requirement map.
   */
  #ensure(name: string): Map<string, AuthorizedField | null> {
    let fields = this.#relations.get(name)
    if (fields) return fields
    const definition = name === 'Entity' ? identityDefinition() : this.#entities.entity(name)
    if (!definition) throw new Error(`Unknown entity "${name}"`)
    fields = new Map()
    this.#relations.set(name, fields)
    return fields
  }

  /**
   * Emit one concrete leaf relation.
   * @param name - Concrete entity name.
   * @returns CTE definition.
   */
  #concreteDefinition(name: string): string {
    const definition = this.#entities.entity(name)
    if (!definition) return ''
    return this.#leafDefinition(definition, this.#relations.get(name) ?? new Map())
  }

  /**
   * Emit one abstract relation as a UNION ALL of concrete leaf relations.
   * @param name - Abstract entity name, including `Entity`.
   * @returns CTE definition.
   */
  #abstractDefinition(name: string): string {
    const definition = name === 'Entity' ? identityDefinition() : this.#entities.entity(name)
    if (!definition) return ''
    const leaves = this.#entities.concreteDescendants(name)
    const required = this.#relations.get(name) ?? new Map()
    const aliases = [...required.keys()].sort()
    if (aliases.length === 0) aliases.push('id')
    const selects = leaves.map(leaf => {
      const leafFields = this.#relations.get(leaf.name) ?? new Map()
      for (const alias of aliases) {
        if (!leafFields.has(alias)) {
          const field = leaf.effectiveFields.find(candidate => fieldAlias(candidate) === alias)
          leafFields.set(alias, field === undefined ? null : { alias, field })
        }
      }
      return `SELECT ${aliases.map(alias => quote(alias)).join(', ')} ` +
        `FROM ${quote(`authorized_${this.#prefix}${leaf.name}`)}`
    })
    const cte = quote(`authorized_${this.#prefix}${name}`)
    if (selects.length === 0) {
      return `${cte} AS NOT MATERIALIZED (` +
        `SELECT ${aliases.map(alias => `NULL AS ${quote(alias)}`).join(', ')} WHERE FALSE)`
    }
    return `${cte} AS NOT MATERIALIZED (${selects.join(' UNION ALL ')})`
  }

  /**
   * Project one concrete leaf with explicit output aliases.
   * @param definition - Concrete entity.
   * @param requirements - Required aliases and optional field metadata.
   * @returns CTE definition.
   */
  #leafDefinition(
    definition: EntityDefinition,
    requirements: ReadonlyMap<string, AuthorizedField | null>,
  ): string {
    const aliases = [...requirements.keys()].sort()
    if (aliases.length === 0) aliases.push('id')
    const owners = new Map<string, string>([[definition.name, 'leaf']])
    const joins: string[] = []
    const projection = aliases.map(alias => {
      const required = requirements.get(alias)
      if (required === null || required === undefined) return `NULL AS ${quote(alias)}`
      const owner = required.field.owner
      let ownerAlias = owners.get(owner)
      if (ownerAlias === undefined) {
        ownerAlias = owner === 'Entity' ? 'root' : `owner_${owner}`
        owners.set(owner, ownerAlias)
        joins.push(
          `JOIN ${quote(owner)} ${quote(ownerAlias)} ` +
          `ON ${quote(ownerAlias)}.${quote('id')} = ${quote('leaf')}.${quote('id')}`,
        )
      }
      return `${quote(ownerAlias)}.${quote(alias)} AS ${quote(alias)}`
    })
    const name = definition.name
    return `${quote(`authorized_${this.#prefix}${name}`)} AS NOT MATERIALIZED (` +
      `SELECT ${projection.join(', ')} FROM ${quote(name)} ${quote('leaf')} ${joins.join(' ')})`
  }
}

/**
 * Resolve the stable output alias for one effective field.
 * @param field - Effective field.
 * @returns Physical reference column or logical scalar name.
 */
function fieldAlias(field: EffectiveFieldDefinition): string {
  return 'column' in field ? field.column : field.name
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
  readonly columns: SqlFragment[] = []
  /** Additional joins required by the projection. */
  readonly joins: SqlFragment[] = []
  /** Root query occurrence. */
  readonly root: EntityContext
  /** Canonical entity definitions. */
  readonly #entities: EntityDefinitions
  /** Authorized relation requirements and their CTE definitions. */
  readonly #relations: AuthorizedRelations
  /** Batched collection CTE definitions emitted after authorized relations. */
  readonly #batchDefinitions: SqlFragment[] = []
  /** Root predicate used to scope batched collection roots. */
  #rootPredicate?: SqlFragment
  /** Complete selected-root query reused by batched collection CTEs. */
  #rootSelection?: SqlFragment
  /** Next generated table alias number. */
  #alias = 0
  /** Filter-only expression overrides keyed by logical path. */
  readonly #filterExpressions = new Map<string, string>()
  /** Predicate-only renderers that bind filtered collection count values. */
  readonly #filterRenders = new Map<string, (bind: (value: BoundScalar) => SqlFragment) => SqlFragment | string>()
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
  /** Prefix that keeps nested compiler aliases unique. */
  readonly #aliasPrefix: string
  /** Namespace for CTE definitions in this compiler scope. */
  readonly #relationPrefix: string

  /**
   * Create the root occurrence for one query.
   * @param entities - Canonical definitions.
   * @param definition - Root entity being queried.
   * @param budget - Projection limits; defaults to the public query budget.
   * @param rootAlias - Root table alias for this query.
   * @param aliasPrefix - Prefix for nested compiler aliases.
   * @param relationPrefix - Prefix for nested relation CTE names.
   */
  constructor(
    entities: EntityDefinitions,
    definition: EntityDefinition,
    budget: ProjectionBudget = PUBLIC_PROJECTION_BUDGET,
    rootAlias = 't',
    aliasPrefix = '',
    relationPrefix = '',
  ) {
    this.#entities = entities
    this.#relations = new AuthorizedRelations(entities, relationPrefix)
    this.#budget = budget
    this.#aliasPrefix = aliasPrefix
    this.#relationPrefix = relationPrefix
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
   * @param _valueStart - Retained value-start compatibility argument.
   * @param rootPredicate - Root predicate used to scope batched roots.
   * @returns A row hydrator for the requested nested shape.
   * @throws {Error} When a path is invalid or an expansion is not supported.
   */
  build(
    fields: readonly string[],
    _valueStart: number,
    rootPredicate?: SqlFragment,
  ): (row: Record<string, unknown>) => Record<string, unknown> {
    void _valueStart
    this.#rootPredicate = rootPredicate
    if (fields.length === 0) throw new Error('Query fields must be a non-empty array')
    this.#validateBudget(fields)
    const root = this.#node(this.root, [])
    for (const field of fields) this.#addPath(root, splitFieldPath(field), undefined, 0)
    const nodes: ProjectionNode[] = [root]
    for (const node of nodes) {
      for (const reference of node.references) nodes.push(...reference.nodes)
    }
    for (const node of nodes) {
      for (const spec of node.projectedSpecs.values()) {
        if (!this.#canBatchCollection(node, spec) || !this.#addBatchedCollection(node, spec)) {
          this.#addProjectedCollection(node, spec)
        }
      }
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
      join: sql => this.joins.push(typeof sql === 'string' ? sqlText(sql) : sql),
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
   * Resolve one authorized entity relation name.
   * @param name - Entity name.
   * @returns Quoted CTE relation name.
   */
  relation(name: string): string {
    return this.#relations.relation(name)
  }

  /**
   * Emit the planned authorized CTE definitions.
   * @returns Ordered CTE definitions.
   */
  relationDefinitions(): string[] {
    return this.#relations.definitions()
  }

  /**
   * Store the complete selected-root query for batched collection CTEs.
   * @param selection - Root identity query including filters, ordering and pagination.
   */
  setRootSelection(selection: SqlFragment): void {
    this.#rootSelection = selection
  }

  /**
   * Emit batched collection CTE definitions.
   * @returns Ordered batch CTE definitions.
   */
  batchDefinitions(): SqlFragment[] {
    return [...this.#batchDefinitions]
  }

  /**
   * Render one root effective scalar field for predicates and ordering.
   * @param field - Effective scalar field.
   * @param bind - Optional predicate value binder for filtered counts.
   * @returns Physical SQL expression.
   */
  expression(field: QueryFieldDefinition, bind?: (value: BoundScalar) => SqlFragment): SqlFragment | string {
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
   * Resolve one predicate path and its SQL expression through canonical metadata.
   * @param context - Occurrence where the predicate path starts.
   * @param name - Full logical predicate path.
   * @param sink - Local SQL join sink for this resolution scope.
   * @returns The SQL expression, scalar field, identity classification, or count metadata.
   * @throws {Error} When canonical path resolution fails or a physical variant cannot compile.
   */
  #resolveFilterPath(
    context: EntityContext,
    name: string,
    sink: FilterJoinScope = this.#outerFilterScope(),
  ): {
    count?: CountScope,
    expression: string,
    field: QueryFieldDefinition,
    identity: boolean,
    render?: (bind: (value: BoundScalar) => SqlFragment) => SqlFragment | string,
  } {
    const resolved = resolvePredicatePath(context.definition, name, {
      definitions: this.#entities,
    })
    if ('kind' in resolved) throw this.#pathError(context, name, resolved)
    const terminal = resolved.terminal
    if (!('kind' in terminal)
      && terminal.type === FieldType.Number
      && (name.endsWith('.$total') || name.endsWith('.$matched'))) {
      return this.#resolveCanonicalCount(context, name, resolved, sink)
    }
    if ('kind' in terminal) {
      throw new Error(`Filter path "${name}" is a collection navigation, not a scalar path`)
    }
    return this.#resolveCanonicalScalar(context, name, resolved, sink)
  }

  /**
   * Translate one canonical path failure into the predicate compiler's error contract.
   * @param context - Occurrence where resolution started.
   * @param name - Full logical predicate path.
   * @param failure - Canonical path failure.
   * @returns The equivalent compiler error.
   */
  #pathError(context: EntityContext, name: string, failure: PathFailure): Error {
    if (failure.kind === 'depth') {
      return new Error(`Reference path "${name}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
    }
    if (failure.kind === 'non-reference') {
      return new Error(`Filter path "${name}" traverses non-reference field "${failure.segment}"`)
    }
    if (failure.kind === 'invalid-count') {
      return new Error(`Query count path "${name}" requires a collection or native array field`)
    }
    if (failure.kind === 'ambiguous') {
      return new Error(
        `Descendant field "${context.definition.name}.${name}" has incompatible declarations`,
      )
    }
    return new Error(`Unknown field "${context.definition.name}.${name}"`)
  }

  /**
   * Build SQL occurrences for every canonical physical path variant.
   * @param context - Occurrence where the predicate path starts.
   * @param name - Full logical predicate path.
   * @param resolved - Canonical path resolution.
   * @param sink - Local SQL join sink for this resolution scope.
   * @returns One branch per canonical physical variant.
   * @throws {Error} When a canonical variant cannot be compiled.
   */
  #canonicalBranches(
    context: EntityContext,
    name: string,
    resolved: ResolvedPredicatePath,
    sink: FilterJoinScope,
  ): readonly CanonicalFilterBranch[] {
    if (resolved.variants.length === 0) {
      throw new Error(`Predicate path "${name}" resolved without physical variants`)
    }
    return resolved.variants.map(variant => {
      if (variant.fields.length === 0) {
        throw new Error(`Predicate path "${name}" resolved without a physical terminal`)
      }
      let current = context
      let prefix = ''
      const occurrences = new Map<string, string>([['', context.rootAlias]])
      for (let fieldIndex = 0; fieldIndex < variant.fields.length - 1; fieldIndex += 1) {
        const field = variant.fields[fieldIndex]
        if (!field || 'kind' in field) {
          throw new Error(
            `Predicate path "${name}" contains a collection before its physical terminal`,
          )
        }
        if (field.type !== FieldType.Entity) {
          throw new Error(
            `Predicate path "${name}" traverses non-reference field "${field.name}"`,
          )
        }
        const sourceAlias = this.#ownerAlias(current, field.owner, true, sink)
        const nextPrefix = prefix === '' ? field.name : `${prefix}.${field.name}`
        current = this.#filterTarget(
          field,
          sourceAlias,
          this.#filterJoinKey(current, nextPrefix, field, sourceAlias, resolved.variants.length),
          current.definition,
          sink,
        )
        prefix = nextPrefix
        occurrences.set(prefix, current.rootAlias)
      }
      return { context: current, occurrences, variant }
    })
  }

  /**
   * Build a stable shared-join key for one physical reference occurrence.
   * @param context - Occurrence owning the reference column.
   * @param prefix - Logical reference prefix.
   * @param field - Reference field being traversed.
   * @param sourceAlias - Alias of the table holding the reference column.
   * @param variantCount - Number of canonical physical variants for the path.
   * @returns Stable join-cache key.
   */
  #filterJoinKey(
    context: EntityContext,
    prefix: string,
    field: EffectiveFieldDefinition,
    sourceAlias: string,
    variantCount: number,
  ): string {
    const declared = context.effective.get(field.name)
    const column = 'column' in field ? field.column : ''
    if (variantCount === 1
      && declared?.owner === field.owner
      && declared !== undefined
      && 'column' in declared
      && declared.column === column) {
      return prefix
    }
    return `${prefix}\u0000${field.owner}\u0000${field.name}\u0000${column}\u0000${sourceAlias}`
  }

  /**
   * Render the discriminator guard for one canonical physical variant.
   * @param context - Occurrence where the predicate path starts.
   * @param name - Full logical predicate path.
   * @param branch - Canonical physical branch.
   * @param sink - Local SQL join sink for this resolution scope.
   * @returns SQL guard, or `TRUE` when the variant is unrestricted.
   * @throws {Error} When a restriction has no physical occurrence.
   */
  #canonicalBranchGuard(
    context: EntityContext,
    name: string,
    branch: CanonicalFilterBranch,
    sink: FilterJoinScope,
  ): string {
    const guards = branch.variant.restrictions.map(restriction => {
      const prefixName = restriction.path === 'entity'
        ? ''
        : restriction.path.slice(0, -'.entity'.length)
      const alias = prefixName === ''
        ? this.#ensureRoot(context, sink)
        : branch.occurrences.get(prefixName)
      if (alias === undefined) {
        throw new Error(
          `Predicate path "${name}" restriction "${restriction.path}" has no physical occurrence`,
        )
      }
      return `${alias}.${quote('entity')} IN (` +
        `${restriction.entityTypes.map(quoteLiteral).join(', ')})`
    })
    return guards.length === 0 ? 'TRUE' : guards.join(' AND ')
  }

  /**
   * Render one canonical scalar or reference-identity predicate path.
   * @param context - Occurrence where the predicate path starts.
   * @param name - Full logical predicate path.
   * @param resolved - Canonical path resolution.
   * @param sink - Local SQL join sink for this resolution scope.
   * @returns The SQL expression and field metadata.
   * @throws {Error} When physical variants disagree about identity.
   */
  #resolveCanonicalScalar(
    context: EntityContext,
    name: string,
    resolved: ResolvedPredicatePath,
    sink: FilterJoinScope,
  ): {
    expression: string,
    field: QueryFieldDefinition,
    identity: boolean,
  } {
    const branches = this.#canonicalBranches(context, name, resolved, sink).map(branch => {
      const terminal = branch.variant.fields.at(-1)
      if (!terminal || 'kind' in terminal) {
        throw new Error(`Predicate path "${name}" has no scalar physical terminal`)
      }
      const previous = branch.variant.fields.at(-2)
      const referenceTerminal = terminal.type === FieldType.Entity
      const identity = referenceTerminal
        || (terminal.name === 'id'
          && previous !== undefined
          && !('kind' in previous)
          && previous.type === FieldType.Entity)
      this.#registerField(branch.context.definition, terminal)
      const expression = referenceTerminal
        ? `${this.#ownerAlias(branch.context, terminal.owner, true, sink)}.${quote(terminal.column)}`
        : this.#expression(branch.context, terminal, true, false, sink)
      return {
        expression,
        guard: this.#canonicalBranchGuard(context, name, branch, sink),
        identity,
        previous,
        terminal,
      }
    })
    const first = branches[0]
    if (!first) throw new Error(`Predicate path "${name}" has no compilable physical variant`)
    if (branches.some(branch => branch.identity !== first.identity)) {
      throw new Error(`Predicate path "${name}" has incompatible descendant declarations`)
    }
    let field = resolved.terminal as QueryFieldDefinition
    if (first.identity) {
      const reference = first.terminal.type === FieldType.Entity
        ? first.terminal
        : first.previous
      if (reference !== undefined && !('kind' in reference) && reference.type === FieldType.Entity) {
        const target = reference.target === 'Entity'
          ? identityDefinition()
          : this.#entities.entity(reference.target)
        if (target?.idFormat !== undefined) {
          field = { ...field, format: target.idFormat } as unknown as QueryFieldDefinition
        }
      }
    }
    if (branches.length === 1 && first.guard === 'TRUE') {
      return { expression: first.expression, field, identity: first.identity }
    }
    const cases = branches.map(branch => (
      `WHEN ${branch.guard} THEN ${branch.expression}`
    )).join(' ')
    return {
      expression: `CASE ${cases} ELSE NULL END`,
      field,
      identity: first.identity,
    }
  }

  /**
   * Resolve one canonical count path into bind-aware count metadata.
   * @param context - Occurrence where the count path starts.
   * @param name - Full logical count path.
   * @param resolved - Canonical path resolution.
   * @param sink - Local SQL join sink for this resolution scope.
   * @returns Count forms or a filtered `$matched` renderer.
   * @throws {Error} When the terminal is not a collection or native array.
   */
  #resolveCanonicalCount(
    context: EntityContext,
    name: string,
    resolved: ResolvedPredicatePath,
    sink: FilterJoinScope,
  ): {
    count?: CountScope,
    expression: string,
    field: QueryFieldDefinition,
    identity: boolean,
    render?: (bind: (value: BoundScalar) => SqlFragment) => SqlFragment | string,
  } {
    const segments = splitFieldPath(name)
    const ownerSegment = segments[segments.length - 2]
    if (ownerSegment === undefined) throw new Error(`Invalid count path "${name}"`)
    const directives = parseCollectionDirectives(ownerSegment)
    if (directives.limit !== undefined
      || directives.offset !== undefined
      || directives.orderBy !== undefined) {
      const suffix = name.endsWith('.$matched') ? '$matched' : '$total'
      throw new Error(
        `Collection ${suffix} does not accept limit, offset, or orderBy directives`,
      )
    }
    const filter = name.endsWith('.$matched') ? directives.filter : undefined
    const branches = this.#canonicalBranches(context, name, resolved, sink)
    const parts = branches.map((branch, index) => {
      const terminal = branch.variant.fields.at(-1)
      if (!terminal) {
        throw new Error(`Predicate path "${name}" has no count terminal`)
      }
      const guard = this.#canonicalBranchGuard(context, name, branch, sink)
      if ('kind' in terminal) {
        const key = `${name}\u0000${index}`
        const plan = this.#collectionPlan(terminal, branch.context.baseAlias, key)
        this.#consume(plan.work)
        if (filter !== undefined) {
          return {
            count: undefined,
            guard,
            render: this.#collectionMatchedRenderer(plan, filter),
          }
        }
        const count = this.#collectionCountExpression(plan, key)
        const fragmentRender = (_bind: (value: BoundScalar) => SqlFragment): SqlFragment => {
          void _bind
          return sqlFragment`(${count.fragment as SqlFragment})`
        }
        const render = count.render ?? (count.fragment === undefined ? undefined : fragmentRender)
        return { count, expression: count.expression, guard, render }
      }
      if (terminal.type !== FieldType.Array) {
        throw new Error(`Query count path "${name}" requires a collection or native array field`)
      }
      this.#consume()
      const expression = `COALESCE(cardinality(${this.#expression(branch.context, terminal, true, false, sink)}), 0)`
      return {
        count: {
          empty: `${expression} = 0`,
          exists: `${expression} > 0`,
          expression,
        },
        expression,
        guard,
      }
    })
    const field: QueryFieldDefinition = { name, type: FieldType.Number }
    if (parts.length === 1 && parts[0]?.guard === 'TRUE') {
      const part = parts[0]
      if (filter !== undefined && part.render !== undefined) {
        return { expression: '', field, identity: false, render: part.render }
      }
      if (part.count !== undefined) {
        return { count: part.count, expression: '', field, identity: false }
      }
      const expression = part.expression as string
      return {
        count: {
          empty: `COALESCE((${expression}), 0) = 0`,
          exists: `COALESCE((${expression}), 0) > 0`,
          expression,
        },
        expression: '',
        field,
        identity: false,
      }
    }
    const render = (bind: (value: BoundScalar) => SqlFragment): SqlFragment => (
      sqlFragment`CASE ${sqlConcat(parts.map(part => {
        const value = part.render === undefined ? sqlText(part.expression as string) : part.render(bind)
        return sqlFragment`WHEN ${sqlText(part.guard)} THEN (${value})`
      }), ' ')} ELSE 0 END`
    )
    if (filter !== undefined) {
      return { expression: '', field, identity: false, render }
    }
    if (parts.some(part => part.render !== undefined)) {
      return {
        count: {
          empty: bind => sqlFragment`COALESCE((${render(bind)}), 0) = 0`,
          exists: bind => sqlFragment`COALESCE((${render(bind)}), 0) > 0`,
          expression: '',
          render,
        },
        expression: '',
        field,
        identity: false,
      }
    }
    const expression = render(() => sqlText('')).sql
    return {
      count: {
        empty: `COALESCE((${expression}), 0) = 0`,
        exists: `COALESCE((${expression}), 0) > 0`,
        expression,
      },
      expression: '',
      field,
      identity: false,
    }
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
    const relationName = resolved.resultType === 'entity' && targetName !== undefined
      ? this.#relations.relationName(targetName)
      : undefined
    if (targetName !== undefined) {
      this.#relations.registerAlias(targetName, 'id')
      this.#relations.registerAlias(targetName, resolved.owner.column)
    }
    const sql = collectionSqlRelation(
      this.#entities,
      resolved,
      `"${parentAlias}".${quote('id')}`,
      {
        authorized: true,
        relationship: relationshipAlias ?? '',
        root: rootAlias ?? '',
        target: targetAlias ?? '',
        ...(relationName === undefined ? {} : {
          [targetName === 'Entity' ? 'rootRelation' : 'targetRelation']: relationName,
        }),
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
      ...(sql.rootAlias === undefined ? {} : { rootAlias: sql.rootAlias }),
      ...(sql.targetAlias === undefined ? {} : { targetAlias: sql.targetAlias }),
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
      : sqlConcat([' AND (', plan.predicate as SqlFragment, ')'])
    const rootAlias = plan.rootAlias
    if (rootAlias === undefined) {
      throw new Error(`Entity collection "${plan.collection.name}" has no identity root`)
    }
    return sqlConcat([
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
    )
    const normalized = QueryNormalizer.normalize(
      plan.target,
      filter,
      scope.field,
      scope.collection,
      scope.array,
    ) ?? undefined
    const relationshipPrefix = plan.relationship === undefined
      ? undefined
      : `${lowerFirst(plan.relationship.name)}.`
    let lowered: Filter | undefined
    if (normalized !== undefined) {
      lowered = PredicateEligibility.lowerMember(
        this.#entities,
        plan.target,
        normalized,
        relationshipPrefix,
        plan.relationship?.fields.map(field => field.name),
      )
    }
    const predicate = lowered === undefined
      ? { predicate: '', sql: '', values: [] }
      : SQL.whereFilter(this.#entities, plan.target.name, lowered, scope)
    const identity = scope.expression(scope.field('id'))
    const filterFragment = predicate.sql === ''
      ? undefined
      : predicate as SqlFragment
    return sqlConcat([
      'EXISTS (SELECT 1 FROM ', scope.relation, ' WHERE ', scope.condition,
      scope.predicate === undefined ? undefined : sqlConcat([' AND (', scope.predicate, ')']),
      filterFragment === undefined ? undefined : sqlConcat([' AND (', filterFragment, ')']),
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
  ): (bind: (value: BoundScalar) => SqlFragment) => SqlFragment {
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
    const member = adapter.compile(filter)
    const count = collectionIdentityCount(member, adapter.identity, adapter.identityUnique)
    return _bind => {
      void _bind
      return sqlFragment`(${count})`
    }
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
    if (filter === undefined) return { predicate: '', sql: '', values: [] }
    const scope = this.#recordScope(plan)
    const normalized = QueryNormalizer.normalize(
      plan.target,
      filter,
      scope.field,
      scope.collection,
      scope.array,
    ) ?? undefined
    return normalized === undefined
      ? { predicate: '', sql: '', values: [] }
      : SQL.whereFilter(this.#entities, plan.target.name, normalized, scope)
  }

  /**
   * Build the correlated scope used by one collection comparison.
   * @param name - Root collection navigation name.
   * @returns Collection scope, or undefined when the name is not a collection.
   */
  collectionScope(name: string): CollectionScope | undefined {
    const cached = this.#collectionScopes.get(name)
    if (cached) return cached
    const canonical = this.#canonicalCollectionScope(this.root, name, this.#outerFilterScope())
    if (canonical) this.#collectionScopes.set(name, canonical)
    return canonical
  }

  /**
   * Build collection scopes from canonical variants at any occurrence.
   * @param context - Occurrence where the collection path starts.
   * @param name - Logical collection path.
   * @param sink - Local join sink for reference traversal.
   * @returns Variant-aware scope, or undefined when the path is not a collection.
   * @throws {Error} When a canonical variant cannot be compiled as a collection.
   */
  #canonicalCollectionScope(
    context: EntityContext,
    name: string,
    sink: FilterJoinScope,
  ): CollectionScope | undefined {
    const resolved = resolvePredicatePath(context.definition, name, {
      definitions: this.#entities,
    })
    if ('kind' in resolved || !('kind' in resolved.terminal)) return undefined
    const scopes = this.#canonicalBranches(context, name, resolved, sink).map((branch, index) => {
      const terminal = branch.variant.fields.at(-1)
      if (!terminal || !('kind' in terminal)) {
        throw new Error(`Predicate path "${name}" resolved without a collection terminal`)
      }
      return {
        guard: this.#canonicalBranchGuard(context, name, branch, sink),
        scope: this.#scopeForCollection(
          { collection: terminal, parentAlias: branch.context.baseAlias },
          `${name}\u0000${index}`,
        ),
      }
    })
    const [first] = scopes
    if (!first) {
      throw new Error(`Predicate path "${name}" resolved without compilable collection variants`)
    }
    return { ...first.scope, variants: scopes }
  }

  /**
   * Build the correlated scope used by one resolved collection.
   * @param resolved - Resolved collection and its owning occurrence.
   * @param resolved.collection - Collection navigation.
   * @param resolved.parentAlias - Alias of the occurrence owning the collection.
   * @param name - Stable logical collection path.
   * @returns The collection scope.
   */
  #scopeForCollection(
    resolved: { collection: DerivedCollectionDefinition, parentAlias: string },
    name: string,
  ): CollectionScope {
    const plan = this.#collectionPlan(resolved.collection, resolved.parentAlias, name)
    this.#consume(plan.work)
    const relationship = plan.relationship
    const relationshipAlias = plan.relationshipAlias
    const condition = plan.condition
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
        predicate: plan.predicate as SqlFragment,
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
    const counts = new Map<string, CountScope>()
    const expressions = new Map<string, string>()
    const identities = new Set<string>()
    const renders = new Map<string, (bind: (value: BoundScalar) => SqlFragment) => SqlFragment | string>()
    const resolvedFields = new Map<string, QueryFieldDefinition>()
    const joins: SqlFragment[] = []
    const sink: FilterJoinScope = {
      alias: prefix => this.#nextAlias(prefix),
      cache: new Map(),
      consume: units => this.#consume(units),
      join: sql => joins.push(typeof sql === 'string' ? sqlText(sql) : sql),
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
      const result = this.#resolveFilterPath(context, path, sink)
      resolvedFields.set(path, result.field)
      expressions.set(path, result.expression)
      if (result.count) counts.set(path, result.count)
      if (result.render) renders.set(path, result.render)
      if (result.identity) identities.add(path)
      return result.field
    }
    const scope: CollectionScope = {
      array: nested => this.#arrayScopeFor(context, nested, sink),
      collection: nested => this.#canonicalCollectionScope(context, nested, sink),
      condition,
      consume: units => this.#consume(units),
      definition: plan.target,
      expression: (field, bind) => {
        const render = renders.get(field.name)
        if (render) {
          if (!bind) throw new Error(`Collection count field "${field.name}" requires a value binder`)
          return render(bind)
        }
        const count = counts.get(field.name)
        if (count) {
          if (bind && count.render) return count.render(bind)
          if (count.expression === '') {
            throw new Error(`Collection count field "${field.name}" requires a value binder`)
          }
          return count.expression
        }
        const expression = expressions.get(field.name)
        if (!expression) throw new Error(`Unresolved collection field "${field.name}"`)
        return expression
      },
      field: resolve,
      filterCount: path => counts.get(path),
      filterKind: path => (identities.has(path) ? 'identity' : undefined),
      predicate: plan.predicate as SqlFragment,
      get relation() { return sqlConcat([plan.relation, ...joins]).sql },
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
    const cacheKey = `${key}\u0000${plan.parentAlias}`
    const cached = this.#countScopes.get(cacheKey)
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
    const exists = sqlConcat(['EXISTS (SELECT 1 FROM (', member, ') AS "__member")'])
    const empty = sqlConcat(['NOT EXISTS (SELECT 1 FROM (', member, ') AS "__member")'])
    const scope: CountScope = {
      empty: _bind => {
        void _bind
        return empty
      },
      exists: _bind => {
        void _bind
        return exists
      },
      expression: count.values.length === 0 ? `(${count.sql})` : '',
      fragment: count,
      render: _bind => {
        void _bind
        return sqlFragment`(${count})`
      },
    }
    this.#countScopes.set(cacheKey, scope)
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
      const result = this.#resolveFilterPath(context, name, sink)
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
    const resolved = this.#resolveFilterPath(this.root, name)
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
              node.context.definition,
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
    return this.#target(field, [...source.path, field.name], sourceAlias, source.context.definition)
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
    this.#relations.registerIdentity(source.context.definition)
    if (navigation.target === 'Entity') {
      const alias = this.#nextAlias('r')
      this.#relations.registerAlias('Entity', 'id')
      this.joins.push(sqlText(
        `LEFT JOIN ${this.#relations.relation('Entity')} ${quote(alias)} ON ` +
        `${quote(alias)}.${quote('id')} = "${source.context.baseAlias}"."id"`,
      ))
      const child = this.#node(rootContext(this.#entities, alias), path)
      this.#identity(child)
      return child
    }
    const target = this.#entities.entity(navigation.target)
    if (!target) throw new Error(`Unknown target entity "${navigation.target}"`)
    const alias = this.#nextAlias('b')
    this.#relations.registerAlias(target.name, navigation.reference.column)
    this.joins.push(sqlText(
      `LEFT JOIN ${this.#relations.relation(target.name)} ${quote(alias)} ON ` +
      `${quote(alias)}.${quote(navigation.reference.column)} = ` +
      `"${source.context.baseAlias}"."id"`,
    ))
    const child = this.#node(targetContext(this.#entities, target, alias, alias), path)
    this.#identity(child)
    return child
  }

  /**
   * Join one reference target and create its projection node.
   * @param field - Effective reference field.
   * @param path - Internal projection path for target aliases.
   * @param sourceAlias - Source table alias containing the reference column.
   * @param source - Source entity definition owning the reference field.
   * @returns The target projection node.
   */
  #target(
    field: EffectiveFieldDefinition,
    path: readonly string[],
    sourceAlias: string,
    source: EntityDefinition,
  ): ProjectionNode {
    if (field.type !== FieldType.Entity) throw new Error(`Field "${field.name}" is not a reference`)
    this.#registerField(source, field)
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
      const alias = scope.alias('r')
      this.#relations.registerAlias('Entity', 'id')
      scope.join(
        `LEFT JOIN ${this.#relations.relation('Entity')} ${quote(alias)} ON ` +
        `${quote(alias)}.${quote('id')} = ${sourceAlias}.${quote(field.column)}`,
      )
      return rootContext(this.#entities, alias)
    }
    const target = this.#entities.entity(field.target)
    if (!target) throw new Error(`Unknown target entity "${field.target}"`)
    const alias = scope.alias('b')
    this.#relations.registerAlias(target.name, 'id')
    scope.join(
      `LEFT JOIN ${this.#relations.relation(target.name)} ${quote(alias)} ON ` +
      `${quote(alias)}.${quote('id')} = ${sourceAlias}.${quote(field.column)}`,
    )
    return targetContext(this.#entities, target, alias, alias)
  }

  /**
   * Resolve or create a filter-only reference context.
   * @param field - Effective reference field.
   * @param sourceAlias - Source table alias.
   * @param key - Stable logical prefix key.
   * @param source - Source entity definition owning the reference field.
   * @param scope - Local SQL join sink for this resolution scope.
   * @returns The target occurrence.
   */
  #filterTarget(
    field: EffectiveFieldDefinition,
    sourceAlias: string,
    key: string,
    source: EntityDefinition,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): EntityContext {
    this.#registerField(source, field)
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
   * Resolve the effective collection directives shared by batch and fallback paths.
   * @param spec - Requested collection projection.
   * @param plan - Canonical collection relation plan.
   * @returns Effective limit, offset, and ordering.
   */
  #collectionOptions(
    spec: ProjectedCollectionSpec,
    plan: CollectionRelationPlan,
  ): { readonly limit: number | null, readonly offset: number, readonly orderBy?: OrderBy } {
    const authored = plan.collection.kind === 'explicit' ? plan.collection : undefined
    return {
      limit: spec.limit !== undefined
        ? spec.limit
        : authored?.viaLimit !== undefined ? authored.viaLimit : 3,
      offset: spec.offset !== undefined
        ? spec.offset
        : authored?.viaOffset !== undefined ? authored.viaOffset : 0,
      ...(spec.orderBy ?? authored?.viaOrderBy) === undefined
        ? {}
        : { orderBy: spec.orderBy ?? authored?.viaOrderBy },
    }
  }

  /**
   * Whether one root collection can use the set-oriented batch plan.
   *
   * This remains conservative: it rejects explicit ordering and unsupported
   * relationship shapes. Filters, pagination, nested target projections,
   * edge fields, and record collections use the batch path when their
   * canonical Graph relation supports it.
   * @param node - Projection occurrence owning the collection.
   * @param spec - Requested target fields.
   * @returns `true` when the collection has the proven simple batch shape.
   */
  #canBatchCollection(node: ProjectionNode, spec: ProjectedCollectionSpec): boolean {
    const plan = this.#collectionPlan(
      spec.collection,
      node.context.baseAlias,
      collectionKey(node.path, spec.collection.name),
    )
    if (node.path.length !== 0 || this.#collectionOptions(spec, plan).orderBy !== undefined) return false
    if (plan.resultType === 'record') {
      return plan.collection.kind === 'explicit'
        && plan.relationshipAlias !== undefined
        && spec.edgeFields.size === 0
    }
    return plan.resultType === 'entity'
      && plan.collection.kind === 'explicit'
      && plan.relationshipAlias !== undefined
      && plan.targetAlias !== undefined
      && (spec.edgeFields.size === 0 || this.#edgeProjectionAllowed(plan))
  }

  /**
   * Add a relationship-record collection as a shared relational batch.
   * @param node - Projection occurrence owning the collection.
   * @param spec - Requested record fields.
   * @param plan - Collection relation plan.
   * @returns Whether the record batch plan was emitted.
   */
  #addBatchedRecordCollection(
    node: ProjectionNode,
    spec: ProjectedCollectionSpec,
    plan: CollectionRelationPlan,
  ): boolean {
    if (plan.collection.kind !== 'explicit'
      || plan.relationship === undefined
      || plan.relationshipAlias === undefined) return false
    this.#consume(plan.work)
    const options = this.#collectionOptions(spec, plan)
    const { limit, offset } = options
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) return false
    if (!Number.isInteger(offset) || offset < 0) return false
    let fields: readonly string[]
    let identity: readonly string[]
    let filter: ReturnType<typeof SQL.where> | undefined
    try {
      fields = recordFields(plan, spec.fields)
      identity = plan.relationship.between.map(endpoint => endpoint.field)
      const filterText = spec.filters.size === 0
        ? undefined
        : [...spec.filters].map(value => `(${value})`).join(' $and ')
      filter = filterText === undefined ? undefined : this.#recordPredicate(plan, filterText)
    } catch {
      return false
    }
    const selectedNames = [...new Set([...fields, ...identity])]
    const selected = selectedNames
      .map(name => `${recordColumn(plan, name)} AS ${quote(name)}`)
      .join(', ')
    const selectedFiltered = selectedNames
      .map(name => `${quote('__child')}.${quote(name)} AS ${quote(name)}`)
      .join(', ')
    const suffix = this.#nextAlias('br')
    const rootCte = quote(`batch_roots_${suffix}`)
    const rowsAllCte = quote(`batch_rows_all_${suffix}`)
    const rowsFilteredCte = quote(`batch_rows_filtered_${suffix}`)
    const countsCte = quote(`batch_counts_${suffix}`)
    const itemsCte = quote(`batch_items_${suffix}`)
    const rootAlias = node.context.baseAlias
    const owner = plan.collection.ownerEndpoint.field
    const parentId = `${quote(plan.relationshipAlias)}.${quote(`${owner}.id`)}`
    const rootWhere = this.#rootPredicate === undefined
      ? undefined
      : sqlConcat([' WHERE ', this.#rootPredicate], '')
    const planPredicate = plan.predicate === undefined
      ? undefined
      : sqlConcat([' AND (', plan.predicate as SqlFragment, ')'])
    const filterPredicate = filter === undefined || filter.sql === ''
      ? undefined
      : sqlConcat([' AND (', filter as SqlFragment, ')'])
    const rowsDefinition = (name: string, filtered: boolean): SqlFragment => sqlConcat([
      sqlText(`${name} AS MATERIALIZED (`),
      sqlText(`SELECT ${parentId} AS ${quote('__parent_id')}, ${selected} `),
      sqlText(`FROM ${plan.relation} `),
      sqlText(`JOIN ${rootCte} ${quote(rootAlias)} ON TRUE `),
      sqlText(`WHERE ${plan.condition}`),
      planPredicate,
      filtered ? filterPredicate : undefined,
      sqlText(')'),
    ], '')
    const itemOrder = identity.map(name => `${quote('__child')}.${quote(name)}`).join(', ')
    const itemFields = fields
      .map(name => `${quoteLiteral(name)}, ${quote('__item')}.${quote(name)}`)
      .join(', ')
    const page = limit === null
      ? `${quote('__ordinal')} > ${offset}`
      : `${quote('__ordinal')} > ${offset} AND ` +
        `${quote('__ordinal')} <= ${offset + limit}`
    this.#batchDefinitions.push(
      sqlConcat([
        sqlText(`${rootCte} AS MATERIALIZED (`),
        this.#rootSelection ?? sqlConcat([
          sqlText(`SELECT ${quote(rootAlias)}.${quote('id')} AS ${quote('id')} `),
          sqlText(`FROM ${this.relation(this.root.definition.name)} ${quote(rootAlias)}`),
          rootWhere,
        ], ''),
        sqlText(')'),
      ], ''),
      rowsDefinition(rowsAllCte, false),
      ...(filter === undefined ? [] : [rowsDefinition(rowsFilteredCte, true)]),
      sqlConcat([
        sqlText(`${countsCte} AS MATERIALIZED (`),
        sqlText(`SELECT ${quote('__parent_id')}, count(*)::int AS ${quote('__total')} `),
        sqlText(`FROM ${rowsAllCte} GROUP BY ${quote('__parent_id')})`),
      ], ''),
      sqlConcat([
        sqlText(`${itemsCte} AS MATERIALIZED (`),
        sqlText(`SELECT ${quote('__parent_id')}, `),
        sqlText(`COALESCE(json_agg(json_build_object(${itemFields}) `),
        sqlText(`ORDER BY ${quote('__item')}.${quote('__ordinal')}) `),
        sqlText(`FILTER (WHERE ${page}), '[]'::json) AS ${quote('__items')}, `),
        sqlText(`count(*)::int AS ${quote('__matched')} `),
        sqlText('FROM ('),
        sqlText('SELECT '),
        sqlText('row_number() OVER ('),
        sqlText(`PARTITION BY ${quote('__parent_id')} ORDER BY ${itemOrder}) `),
        sqlText(`AS ${quote('__ordinal')}, `),
        sqlText(`${quote('__child')}.${quote('__parent_id')} AS ${quote('__parent_id')}, `),
        sqlText(`${selectedFiltered} `),
        sqlText(`FROM ${filter === undefined ? rowsAllCte : rowsFilteredCte} AS ${quote('__child')}) `),
        sqlText(`AS ${quote('__item')} `),
        sqlText(`GROUP BY ${quote('__parent_id')})`),
      ], ''),
    )
    const alias = columnAlias(node.path, spec.collection.name)
    const matchedAlias = `${alias}__matched`
    const totalAlias = `${alias}__total`
    const joinAlias = this.#nextAlias('bc')
    const countsAlias = this.#nextAlias('bn')
    this.joins.push(sqlText(
      `LEFT JOIN ${itemsCte} ${quote(joinAlias)} ` +
      `ON ${quote(joinAlias)}.${quote('__parent_id')} = ${quote(rootAlias)}.${quote('id')} ` +
      `LEFT JOIN ${countsCte} ${quote(countsAlias)} ` +
      `ON ${quote(countsAlias)}.${quote('__parent_id')} = ${quote(rootAlias)}.${quote('id')}`,
    ))
    this.columns.push(sqlText(`${quote(joinAlias)}.${quote('__items')} AS ${quote(alias)}`))
    this.columns.push(sqlText(`${quote(joinAlias)}.${quote('__matched')} AS ${quote(matchedAlias)}`))
    this.columns.push(sqlText(`${quote(countsAlias)}.${quote('__total')} AS ${quote(totalAlias)}`))
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
          $total: Number(row[totalAlias] ?? matchedTotal),
          items: entries,
        }
      },
      matchedAlias,
      name: spec.collection.name,
      totalAlias,
    })
    return true
  }

  /**
   * Add one root collection as a shared relational batch.
   *
   * All roots are scoped once, member rows are joined to their owning root,
   * and the per-parent JSON envelope is assembled once. This removes the
   * lateral member query and its repeated matched-count query for the simple
   * shape the planner can prove here.
   * @param node - Projection occurrence owning the collection.
   * @param spec - Requested target fields.
   * @returns Whether the batch plan was emitted.
   */
  #addBatchedCollection(node: ProjectionNode, spec: ProjectedCollectionSpec): boolean {
    const key = collectionKey(node.path, spec.collection.name)
    const plan = this.#collectionPlan(spec.collection, node.context.baseAlias, key)
    if (plan.collection.kind !== 'explicit'
      || plan.relationshipAlias === undefined) return false
    if (plan.resultType === 'record') return this.#addBatchedRecordCollection(node, spec, plan)
    if (plan.targetAlias === undefined) return false
    this.#consume(plan.work)
    const options = this.#collectionOptions(spec, plan)
    const { limit, offset } = options
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) return false
    if (!Number.isInteger(offset) || offset < 0) return false
    const fields = [...new Set(['id', 'name', 'entity', ...spec.fields])]
    const edgeFields = [...spec.edgeFields]
    const filter = spec.filters.size === 0
      ? undefined
      : [...spec.filters].map(value => `(${value})`).join(' $and ')
    const childAlias = this.#nextAlias('b')
    let childAll: CompiledPolymorphicQuery
    let childFiltered: CompiledPolymorphicQuery
    try {
      childAll = compilePolymorphicQuery(this.#entities, plan.target, {
        aliasPrefix: `${childAlias}_`,
        fields,
        limit: null,
        offset: 0,
        relationPrefix: `${this.#relationPrefix}batch_`,
        rootAlias: childAlias,
      })
      if (filter === undefined) {
        childFiltered = childAll
      } else {
        childFiltered = compilePolymorphicQuery(this.#entities, plan.target, {
          aliasPrefix: `${childAlias}_`,
          fields,
          limit: null,
          offset: 0,
          relationPrefix: `${this.#relationPrefix}batch_`,
          rootAlias: childAlias,
          where: filter,
        })
      }
    } catch {
      return false
    }
    const allSql = compiledFragment(childAll)
    const filteredSql = filter === undefined ? allSql : compiledFragment(childFiltered)
    const suffix = this.#nextAlias('bg')
    const itemAlias = quote('__item')
    const ordinalAlias = quote('__ordinal')
    const rootCte = quote(`batch_roots_${suffix}`)
    const rowsAllCte = quote(`batch_rows_all_${suffix}`)
    const rowsFilteredCte = quote(`batch_rows_filtered_${suffix}`)
    const countsCte = quote(`batch_counts_${suffix}`)
    const itemsCte = quote(`batch_items_${suffix}`)
    const rootAlias = node.context.baseAlias
    const owner = plan.collection.ownerEndpoint.field
    const parentId = `${quote(plan.relationshipAlias)}.${quote(`${owner}.id`)}`
    const rootWhere = this.#rootPredicate === undefined
      ? undefined
      : sqlConcat([' WHERE ', this.#rootPredicate], '')
    const rowsDefinition = (name: string, child: SqlFragment): SqlFragment => sqlConcat([
      sqlText(`${name} AS MATERIALIZED (`),
      sqlText(`SELECT ${parentId} AS ${quote('__parent_id')}, ${quote('__child')}.*`),
      edgeFields.length === 0
        ? undefined
        : sqlConcat([sqlText(', '), this.#edgeProjection(plan, edgeFields), sqlText(` AS ${quote('__edge')}`)], ''),
      sqlText(' FROM '),
      sqlText(`${plan.relation} `),
      sqlText(`JOIN ${rootCte} ${quote(rootAlias)} ON TRUE `),
      sqlConcat([sqlText('JOIN ('), child, sqlText(`) AS ${quote('__child')} `)], ''),
      sqlText(`ON ${quote('__child')}.${quote('id')} = ${quote(plan.targetAlias)}.${quote('id')} `),
      sqlText(`WHERE ${plan.condition})`),
    ], '')
    const page = limit === null
      ? `${quote('__ordinal')} > ${offset}`
      : `${quote('__ordinal')} > ${offset} AND ` +
        `${quote('__ordinal')} <= ${offset + limit}`
    this.#batchDefinitions.push(
      sqlConcat([
        sqlText(`${rootCte} AS MATERIALIZED (`),
        this.#rootSelection ?? sqlConcat([
          sqlText(`SELECT ${quote(rootAlias)}.${quote('id')} AS ${quote('id')} `),
          sqlText(`FROM ${this.relation(this.root.definition.name)} ${quote(rootAlias)}`),
          rootWhere,
        ], ''),
        sqlText(')'),
      ], ''),
      rowsDefinition(rowsAllCte, allSql),
      ...(filter === undefined ? [] : [rowsDefinition(rowsFilteredCte, filteredSql)]),
      sqlConcat([
        sqlText(`${countsCte} AS MATERIALIZED (`),
        sqlText(`SELECT ${quote('__parent_id')}, count(*)::int AS ${quote('__total')} `),
        sqlText(`FROM ${rowsAllCte} GROUP BY ${quote('__parent_id')})`),
      ], ''),
      sqlConcat([
        sqlText(`${itemsCte} AS MATERIALIZED (`),
        sqlText(`SELECT ${quote('__parent_id')}, `),
        sqlText(`COALESCE(json_agg(row_to_json(${itemAlias}) ORDER BY ${itemAlias}.${ordinalAlias}) `),
        sqlText(`FILTER (WHERE ${page}), '[]'::json) AS ${quote('__items')}, `),
        sqlText(`count(*)::int AS ${quote('__matched')} `),
        sqlText('FROM ('),
        sqlText('SELECT '),
        sqlText('row_number() OVER ('),
        sqlText(`PARTITION BY ${quote('__parent_id')} ORDER BY ${quote('__child')}.${quote('id')}) `),
        sqlText(`AS ${quote('__ordinal')}, ${quote('__child')}.* `),
        sqlText(`FROM ${filter === undefined ? rowsAllCte : rowsFilteredCte} AS ${quote('__child')}) `),
        sqlText(`AS ${quote('__item')} `),
        sqlText(`GROUP BY ${quote('__parent_id')})`),
      ], ''),
    )
    const alias = columnAlias(node.path, spec.collection.name)
    const matchedAlias = `${alias}__matched`
    const totalAlias = `${alias}__total`
    const joinAlias = this.#nextAlias('bc')
    const countsAlias = this.#nextAlias('bn')
    this.joins.push(sqlText(
      `LEFT JOIN ${itemsCte} ${quote(joinAlias)} ` +
      `ON ${quote(joinAlias)}.${quote('__parent_id')} = ${quote(rootAlias)}.${quote('id')} ` +
      `LEFT JOIN ${countsCte} ${quote(countsAlias)} ` +
      `ON ${quote(countsAlias)}.${quote('__parent_id')} = ${quote(rootAlias)}.${quote('id')}`,
    ))
    this.columns.push(sqlText(
      `${quote(joinAlias)}.${quote('__items')} AS ${quote(alias)}`,
    ))
    this.columns.push(sqlText(
      `${quote(joinAlias)}.${quote('__matched')} AS ${quote(matchedAlias)}`,
    ))
    this.columns.push(sqlText(
      `${quote(countsAlias)}.${quote('__total')} AS ${quote(totalAlias)}`,
    ))
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
          $total: Number(row[totalAlias] ?? matchedTotal),
          items: entries.map(entry => {
            const hydrated = childFiltered.hydrate(entry as Record<string, unknown>)
            const edge = entry.__edge
            if (edge !== undefined && edge !== null && typeof edge === 'object') {
              Object.assign(hydrated, edge)
            }
            return hydrated
          }),
        }
      },
      matchedAlias,
      name: spec.collection.name,
      totalAlias,
    })
    return true
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
    const options = this.#collectionOptions(spec, plan)
    const { limit, offset, orderBy } = options
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error(`Collection "${key}" $limit must be a non-negative integer or null`)
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Collection "${key}" $offset must be a non-negative integer`)
    }
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
    const countAdapter = plan.resultType === 'record'
      ? this.#recordMember(plan, effective, true)
      : this.#entityMember(plan, effective, key, true)
    const orderings = collectionOrderings(plan, effective.orderBy, adapter)
    const matched = adapter.compile(filter)
    const matchedForCount = countAdapter.compile(filter)
    const total = filter === undefined ? undefined : countAdapter.compile(undefined)
    const matchedCount = collectionIdentityCount(
      matchedForCount,
      countAdapter.identity,
      countAdapter.identityUnique,
    )
    const totalCount = total === undefined
      ? undefined
      : collectionIdentityCount(total, countAdapter.identity, countAdapter.identityUnique)
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
    const lateral = sqlConcat([
      'LEFT JOIN LATERAL (SELECT (', items, ') AS "__items", (', matchedCount,
      ') AS "__matched"',
      totalCount === undefined ? undefined : sqlConcat([', (', totalCount, ') AS "__total"']),
      ') AS ', quote(lateralAlias), ' ON TRUE',
    ])
    this.joins.push(lateral)
    const lateralRef = sqlText(quote(lateralAlias))
    this.columns.push(sqlFragment`${lateralRef}.${sqlText(quote('__items'))} AS ${sqlText(quote(alias))}`)
    this.columns.push(sqlFragment`${lateralRef}.${sqlText(quote('__matched'))} AS ${sqlText(quote(matchedAlias))}`)
    if (totalCount !== undefined) {
      this.columns.push(sqlFragment`${lateralRef}.${sqlText(quote('__total'))} AS ${sqlText(quote(totalAlias))}`)
    }
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
        relationPrefix: `${this.#relationPrefix}nested_`,
        rootAlias: childAlias,
        ...(filter === undefined || filtered ? {} : { where: filter }),
      })
      let query: SqlFragment = child as unknown as SqlFragment
      if (projectedEdgeFields.length > 0) {
        query = sqlConcat([
          'SELECT "__child".*, ', this.#edgeProjection(plan, projectedEdgeFields),
          ' AS "__edge" FROM (', query, ') AS "__child"',
        ])
      }
      const result = {
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
      Object.defineProperty(result, 'pieces', { enumerable: false, value: query.pieces })
      return result
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
        : sqlConcat([' AND (', plan.predicate as SqlFragment, ')'])
      const filterFragment = where === undefined || where.sql === ''
        ? undefined
        : where as SqlFragment
      const filterSql = filterFragment === undefined
        ? undefined
        : sqlConcat([' AND (', filterFragment, ')'])
      const query = sqlConcat([
        `SELECT ${selected} FROM ${plan.relation} WHERE ${plan.condition}`,
        predicate,
        filterSql,
      ])
      const result = {
        ...query,
        hydrate: row => Object.fromEntries(
          Object.entries(row).filter(([name]) => !orderOnly.has(name)),
        ),
      }
      Object.defineProperty(result, 'pieces', { enumerable: false, value: query.pieces })
      return result
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
      : sqlConcat([' AND (', plan.predicate as SqlFragment, ')'])
    return sqlConcat([
      '(SELECT json_build_object(', values.join(', '), ') FROM ',
      `${quote(relationship.name)} ${quote(relationshipAlias)}`,
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
    const composed = sqlConcat([fragment])
    this.#addComputedFragmentColumn(node, name, composed)
  }

  /**
   * Select one computed fragment field.
   * @param node - Projection occurrence.
   * @param name - Logical computed field name.
   * @param fragment - Parameterized SQL fragment.
   */
  #addComputedFragmentColumn(node: ProjectionNode, name: string, fragment: SqlFragment): void {
    if (node.fieldNames.has(name)) return
    const alias = columnAlias(node.path, name)
    this.columns.push(sqlFragment`(${fragment}) AS ${sqlText(quote(alias))}`)
    node.fields.push({ alias, name })
    node.fieldNames.add(name)
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
    this.columns.push(sqlText(`${expression} AS ${quote(alias)}`))
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
    this.columns.push(sqlText(`${expression} AS ${quote(alias)}`))
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
      this.#registerField(node.context.definition, variant.field)
      const owner = this.#ownerAlias(node.context, variant.field.owner, true)
      const leaves = variant.leaves.map(quoteLiteral).join(', ')
      return `WHEN ${node.context.baseAlias}.${quote('entity')} IN (${leaves}) ` +
        `THEN ${owner}.${quote(fieldAlias(variant.field))}`
    })
    const alias = columnAlias(node.path, field.name)
    this.columns.push(sqlText(`CASE ${branches.join(' ')} ELSE NULL END AS ${quote(alias)}`))
    node.fields.push({ alias, name: field.name })
    node.fieldNames.add(field.name)
  }

  /**
   * Select the default identity for a reference target.
   *
   * The public reference hydration contract always contains `entity`, `id`, and
   * `name`. A final concrete type can supply its ID from the concrete row and
   * its type from Graph metadata, but its inherited name still lives on
   * `Entity`; the root join below is therefore required even for a path that
   * requested only the ID.
   * @param node - Reference target occurrence.
   */
  #identity(node: ProjectionNode): void {
    if (node.identity) return
    this.#consume(3)
    const prefix = node.path.join('__')
    const entity = `${prefix}__entity`
    const id = `${prefix}__id`
    const name = `${prefix}__name`
    const definition = node.context.definition
    const concrete = !node.context.rootOnly && !definition.abstract
    const entityExpression = concrete
      ? quoteLiteral(definition.name)
      : `${node.context.baseAlias}.${quote('entity')}`
    this.#ensureRoot(node.context)
    this.columns.push(
      sqlText(`${entityExpression} AS ${quote(entity)}`),
      sqlText(`${node.context.baseAlias}.${quote('id')} AS ${quote(id)}`),
      sqlText(`${node.context.baseAlias}.${quote('name')} AS ${quote(name)}`),
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
    this.#registerField(context.definition, field)
    if (this.#needsLeafJoin(context.definition, field)) {
      return `${this.#ownerAlias(context, field.owner, forceLeft, scope)}.${quote(fieldAlias(field))}`
    }
    return `${context.baseAlias}.${quote(fieldAlias(field))}`
  }

  /**
   * Register one field on the relation that can actually supply it.
   * @param context - Occurrence definition.
   * @param field - Effective field.
   */
  #registerField(context: EntityDefinition, field: EffectiveFieldDefinition): void {
    const owner = this.#entities.entity(field.owner)
    const target = context.abstract && owner !== undefined && !owner.abstract ? owner : context
    this.#relations.register(target, field)
  }

  /**
   * Whether a field must come from a concrete-leaf CTE joined to an abstract row.
   * @param context - Occurrence definition.
   * @param field - Effective field.
   * @returns `true` for concrete-owner fields on an abstract occurrence.
   */
  #needsLeafJoin(context: EntityDefinition, field: EffectiveFieldDefinition): boolean {
    if (!context.abstract || field.owner === context.name || field.owner === 'Entity') return false
    const owner = this.#entities.entity(field.owner)
    return owner !== undefined && !owner.abstract
  }

  /**
   * Ensure a universal root relation exists for one occurrence.
   * @param context - Entity occurrence.
   * @param scope - Local SQL join sink retained for call compatibility.
   * @returns Root table alias.
   */
  #ensureRoot(
    context: EntityContext,
    scope: FilterJoinScope = this.#outerFilterScope(),
  ): string {
    void scope
    this.#relations.registerIdentity(context.definition)
    context.rootJoined = true
    return context.baseAlias
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
    if (owner === 'Entity' || owner === context.definition.name) return context.baseAlias
    const ownerDefinition = this.#entities.entity(owner)
    if (context.definition.abstract && ownerDefinition !== undefined && !ownerDefinition.abstract) {
      const existing = context.ownerAliases.get(owner)
      if (existing) return existing
      const alias = scope.alias('o')
      scope.join(
        `LEFT JOIN ${this.#relations.relation(owner)} ${quote(alias)} ` +
        `ON ${quote(alias)}.${quote('id')} = ${quote(context.baseAlias)}.${quote('id')}`,
      )
      context.ownerAliases.set(owner, alias)
      return alias
    }
    return context.baseAlias
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
    options.relationPrefix,
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
  const normalized = typeof options.where === 'string'
    ? QueryNormalizer.normalize(synthetic, options.where, scope.filterField, scope.collection, scope.array) ?? undefined
    : options.where === undefined
      ? undefined
      : Predicate.normalize(synthetic, options.where, scope.filterField, scope.collection, scope.array) ?? undefined
  const where = normalized === undefined
    ? undefined
    : PredicateEligibility.lower(entities, synthetic, normalized)
  const predicate = where === undefined
    ? { predicate: '', sql: '', values: [] }
    : SQL.whereFilter(entities, definition.name, where, scope)
  let ordering = ''
  if (options.orderBy !== undefined) {
    ordering = SQL.orderBy(entities, definition.name, options.orderBy, scope).sql
    if (ordering !== '' && definition.abstract) ordering += `, ${projection.root.baseAlias}."id" ASC`
  }
  if (ordering === '' && definition.abstract) {
    ordering = `ORDER BY ${projection.root.baseAlias}."name" ASC, ` +
      `${projection.root.baseAlias}."id" ASC`
  }
  const rawValues = options.rawWhere?.values ?? []
  const leaves = definition.abstract
    ? entities.concreteDescendants(definition.name).map(entity => quoteLiteral(entity.name))
    : []
  const leafFilter = leaves.length === 0
    ? sqlText('FALSE')
    : sqlText(`${projection.root.baseAlias}."entity" IN (${leaves.join(', ')})`)
  const conditions: SqlFragment[] = []
  if (definition.abstract) conditions.push(leafFilter)
  if (predicate.sql !== '') conditions.push(predicate as SqlFragment)
  if (options.rawWhere !== undefined) conditions.push(options.rawWhere)
  const whereSql = conditions.length === 0
    ? sqlText('')
    : conditions.length === 1
      ? sqlFragment`WHERE ${conditions[0] as SqlFragment}`
      : sqlFragment`WHERE ${sqlConcat(conditions.map(condition => sqlFragment`(${condition})`), ' AND ')}`
  const limit = options.limit === undefined ? 25 : options.limit
  const pagination = SQL.paginate(limit, options.offset ?? 0)
  const rootRelation = projection.relation(definition.name)
  const rootSelection = sqlConcat([
    sqlText(`SELECT ${quote(projection.root.baseAlias)}.${quote('id')} AS ${quote('id')}`),
    sqlText(` FROM ${rootRelation} ${quote(projection.root.baseAlias)}`),
    ...projection.joins,
    whereSql,
    sqlText(ordering),
    pagination,
  ])
  projection.setRootSelection(rootSelection)
  const hydrate = projection.build(
    options.fields,
    predicate.values.length + rawValues.length + 1,
    predicate.sql === '' ? undefined : predicate as SqlFragment,
  )
  const relationDefinitions = [
    ...projection.relationDefinitions().map(relation => sqlText(relation)),
    ...projection.batchDefinitions(),
  ]
  const relationSql = relationDefinitions.length === 0
    ? undefined
    : sqlConcat(relationDefinitions, ', ')
  const query = sqlConcat([
    relationSql === undefined ? sqlText('') : sqlConcat([sqlText('WITH '), relationSql], ''),
    sqlFragment`SELECT ${sqlConcat(projection.columns, ', ')}`,
    sqlFragment`FROM ${sqlText(rootRelation)} ${sqlText(`"${projection.root.baseAlias}"`)}`,
    ...projection.joins,
    whereSql,
    sqlText(ordering),
    pagination,
  ])
  const compiled = { hydrate, sql: query.sql, values: query.values }
  Object.defineProperty(compiled, 'pieces', { enumerable: false, value: query.pieces })
  return compiled
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
 * Group descendant-only collections by their physical definition.
 * @param entities - Canonical definitions.
 * @param definition - Abstract ancestor being queried.
 * @param name - Logical collection name.
 * @returns Physical variants with their concrete leaves.
 */
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
      const key = `${field.owner}\u0000${logicalFieldContract(field)}`
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
    const contracts = new Set(values.map(variant => logicalFieldContract(variant.field)))
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
 * Render one descendant-reference CASE expression with value-aware branches.
 * @param root - Discriminator root alias.
 * @param branches - Physical descendant branches.
 * @param hasCount - Whether the CASE result is a count.
 * @returns The bind-aware renderer.
 */
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
    return sqlConcat(['SELECT count(*)::int FROM (', member, ') AS "__member"'])
  }
  return sqlConcat([
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
    const paged = sqlConcat([
      'SELECT * FROM (', member, ') AS "__member"',
      order === '' ? undefined : ` ORDER BY ${order}`,
    ])
    return sqlConcat([paged, SQL.paginate(limit, offset)])
  }
  const distinct = sqlConcat([
    'SELECT DISTINCT ON (', identityColumns('__member', identity), ') * FROM (',
    member,
    ') AS "__member" ORDER BY ', identityColumns('__member', identity),
  ])
  const distinctOrder = orderings
    .map(entry => `${quote('__distinct')}.${quote(entry.name)} ${entry.direction}`)
    .join(', ')
  const paged = sqlConcat([
    'SELECT * FROM (', distinct, ') AS "__distinct"',
    distinctOrder === '' ? undefined : ` ORDER BY ${distinctOrder}`,
  ])
  return sqlConcat([paged, SQL.paginate(limit, offset)])
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
  return sqlConcat([
    'SELECT COALESCE(json_agg(row_to_json("__item")',
    order === '' ? undefined : sqlConcat([' ORDER BY ', order]),
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
 * Convert a compiled query back into an ordered SQL fragment.
 * @param compiled - Compiled query with positional values.
 * @returns SQL fragment preserving the query's value order.
 */
function compiledFragment(compiled: CompiledPolymorphicQuery): SqlFragment {
  const parts = compiled.sql.split(/(\$\d+)/u)
  return sqlConcat(parts.map(part => {
    const match = /^\$(\d+)$/u.exec(part)
    if (match === null) return sqlText(part)
    return sqlValue(compiled.values[Number(match[1]) - 1])
  }), '')
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
