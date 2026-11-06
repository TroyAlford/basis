import type { AssociationDefinition, DerivedCollectionDefinition, DerivedSingularDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, QueryFieldDefinition, RelationshipDerivedCollectionDefinition, RelationshipFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'
import type { Filter } from './Predicate'
import { arrayItemField } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { ArrayScope, CollectionScope, OrderBy, QueryScope } from './SQL'
import { SQL } from './SQL'

/** Maximum number of singular reference hops in one requested path. */
const MAX_REFERENCE_DEPTH = 8
/** Maximum number of requested projection paths in one query. */
const MAX_PROJECTION_PATHS = 64
/** Maximum total path segments and selected collections in one query. */
const MAX_PROJECTION_WORK = 128

/** Options accepted by a polymorphic entity query. */
export interface PolymorphicQueryOptions {
  /** Per-collection preview and pagination overrides. */
  readonly collections?: Readonly<Record<string, {
    readonly limit?: number,
    readonly offset?: number,
    readonly relationshipFields?: readonly string[],
  }>>,
  /** Effective scalar, scalar-array, JSON, collection, or singular-reference paths to project. */
  readonly fields: readonly string[],
  /** Maximum rows to return; defaults to 25, or `null` for unlimited. */
  readonly limit?: number | null,
  /** Rows to skip; defaults to 0. */
  readonly offset?: number,
  /** Explicit effective-field ordering, single or multi-level. */
  readonly orderBy?: OrderBy,
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

/** One entity collection projection. */
interface CollectionProjection {
  /** SQL alias for the JSON items array. */
  readonly itemsAlias: string,
  /** Output field name. */
  readonly name: string,
  /** SQL alias for the remaining count. */
  readonly remainingAlias: string,
  /** SQL alias for the total count. */
  readonly totalAlias: string,
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
  /** Collection field names already selected at this node. */
  readonly collectionNames: Set<string>,
  /** Entity collections selected at this node. */
  readonly collections: CollectionProjection[],
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

/** Count expression and canonical existence forms for one logical path. */
interface CountExpression {
  /** Zero-count predicate. */
  readonly empty: string,
  /** Non-zero existence predicate. */
  readonly exists: string,
  /** Numeric count expression. */
  readonly expression: string,
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
  readonly #countFields = new Map<string, CountExpression>()
  /** Count CTE definitions keyed by physical count path. */
  readonly #countCtes = new Map<string, CountExpression>()
  /** Stable filter/projection reference contexts keyed by logical path. */
  readonly #filterContexts = new Map<string, EntityContext>()
  /** Filter paths that resolve to reference identities. */
  readonly #filterIdentities = new Set<string>()
  /** Graph work consumed while expanding the projection. */
  #work = 0
  /** Collection configuration overrides. */
  readonly #collections: Readonly<Record<string, {
    readonly limit?: number,
    readonly offset?: number,
    readonly relationshipFields?: readonly string[],
  }>> | undefined
  /** Selected collection option keys. */
  readonly #selectedCollectionKeys = new Set<string>()
  /** Values bound by collection subqueries. */
  readonly values: unknown[] = []
  /** Starting placeholder index for collection values. */
  #valueStart = 1

  /**
   * Create the root occurrence for one query.
   * @param entities - Canonical definitions.
   * @param definition - Root entity being queried.
   * @param collections - Per-collection preview overrides.
   */
  constructor(
    entities: EntityDefinitions,
    definition: EntityDefinition,
    collections?: Readonly<Record<string, {
      readonly limit?: number,
      readonly offset?: number,
      readonly relationshipFields?: readonly string[],
    }>>,
  ) {
    this.#entities = entities
    this.#collections = collections
    this.root = {
      baseAlias: 't',
      collections: new Map(definition.collections.map(collection => [collection.name, collection])),
      definition,
      descendants: descendantFields(entities, definition),
      effective: new Map(definition.effectiveFields.map(field => [field.name, field])),
      isTarget: false,
      ownerAliases: new Map([[definition.name, 't']]),
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
    for (const field of fields) this.#addPath(root, field.split('.'), undefined, 0)
    for (const name of Object.keys(this.#collections ?? {})) {
      if (!this.#selectedCollectionKeys.has(name)) {
        throw new Error(`Collection options were provided for unselected field "${name}"`)
      }
    }
    return row => hydrateRoot(row, root)
  }

  /**
   * Validate path count and total graph work before compiling SQL.
   * @param fields - Requested field paths.
   */
  #validateBudget(fields: readonly string[]): void {
    const collections = Object.keys(this.#collections ?? {})
    if (fields.length + collections.length > MAX_PROJECTION_PATHS) {
      throw new Error(
        `Query projection exceeds the maximum path count of ${MAX_PROJECTION_PATHS}`,
      )
    }
    const collectionWork = (this.#collections
      ? Object.values(this.#collections)
      : []).reduce((total, config) => (
      total + 1 + (config.relationshipFields?.length ?? 0)
    ), 0)
    const work = fields.reduce((total, field) => total + field.split('.').length, collectionWork)
    if (work > MAX_PROJECTION_WORK) {
      throw new Error(
        `Query projection exceeds the maximum graph work budget of ${MAX_PROJECTION_WORK}`,
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
  ): { expression: string, field: QueryFieldDefinition, identity: boolean } {
    const [segment] = segments
    if (segment === undefined) throw new Error(`Invalid filter path "${fullName}"`)
    const rest = segments.slice(1)
    if (rest.length === 1 && rest[0] === '$count') {
      const collection = context.collections.get(segment)
      if (collection) {
        const key = fullName.slice(0, -7)
        const plan = this.#collectionPlan(collection, context.baseAlias, key)
        this.#consume(plan.work)
        const count = this.#collectionCountExpression(plan, fullName)
        this.#countFields.set(fullName, count)
        return { expression: '', field: { name: fullName, type: FieldType.Number }, identity: false }
      }
      const countField = context.effective.get(segment)
      if (countField?.type === FieldType.Array) {
        const expression = this.#arrayCountExpression(context, countField, scope)
        const count = {
          empty: `COALESCE(cardinality(${expression}), 0) = 0`,
          exists: `COALESCE(cardinality(${expression}), 0) > 0`,
          expression: `COALESCE(cardinality(${expression}), 0)`,
        }
        this.#countFields.set(fullName, count)
        this.#consume()
        return { expression: '', field: { name: fullName, type: FieldType.Number }, identity: false }
      }
      throw new Error(`Query count path "${fullName}" requires a collection or native array field`)
    }
    const field = context.effective.get(segment)
    if (field) {
      if (rest.length === 0) {
        if (field.type === FieldType.Entity) {
          if (depth >= MAX_REFERENCE_DEPTH) {
            throw new Error(`Reference path "${fullName}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
          }
          const target = this.#entities.entity(field.target)
          const sourceAlias = this.#ownerAlias(context, field.owner, false, scope)
          const childKey = contextKey === '' ? segment : `${contextKey}.${segment}`
          const targetOccurrence = this.#filterTarget(field, sourceAlias, childKey, scope)
          return {
            expression: `${targetOccurrence.rootAlias}.${quote('id')}`,
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
    const branches = descendant.variants.map(variant => {
      const owner = this.#ownerAlias(context, variant.owner, true, scope)
      const variantKey = `${contextKey}.${segment}#${variant.owner}`
      const targetOccurrence = this.#filterTarget(variant.field, owner, variantKey, scope)
      const resolved = this.#resolveFilterPath(targetOccurrence, rest, fullName, variantKey, depth + 1, scope)
      resolvedIdentity = resolved.identity
      if (!resolvedField) resolvedField = resolved.field
      else if (
        resolvedField.type !== resolved.field.type
        || ('format' in resolvedField ? resolvedField.format : undefined) !==
          ('format' in resolved.field ? resolved.field.format : undefined)
      ) {
        throw new Error(`Filter path "${fullName}" has incompatible descendant declarations`)
      }
      const leaves = variant.leaves.map(quoteLiteral).join(', ')
      return `WHEN ${root}.${quote('entity')} IN (${leaves}) THEN ${resolved.expression}`
    })
    if (!resolvedField) throw new Error(`Filter path "${fullName}" has no descendant declaration`)
    return {
      expression: `CASE ${branches.join(' ')} ELSE NULL END`,
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
    let relation: string
    let condition: string
    let parentId: string
    if (collection.kind === 'inverse') {
      if (targetAlias === undefined) {
        relation = `"Entity" "${rootAlias}"`
        condition = `"${rootAlias}".${quote('id')} = "${parentAlias}".${quote('id')}`
      } else {
        relation = `"${targetName}" "${targetAlias}" JOIN "Entity" "${rootAlias}" ` +
          `ON "${rootAlias}".${quote('id')} = "${targetAlias}".${quote('id')}`
        condition = `"${targetAlias}".${quote(collection.reference.column)} = ` +
          `"${parentAlias}".${quote('id')}`
      }
      parentId = targetAlias === undefined
        ? `"${rootAlias}".${quote('id')}`
        : `"${targetAlias}".${quote(collection.reference.column)}`
    } else {
      const local = relationship.between[collection.endpoint]
      const remote = relationship.between[collection.endpoint === 0 ? 1 : 0]
      const remoteColumn = quote(`${remote.field}.id`)
      if (targetAlias === undefined) {
        relation = `"${relationship.name}" "${relationshipAlias}" JOIN "Entity" "${rootAlias}" ` +
          `ON "${rootAlias}".${quote('id')} = "${relationshipAlias}".${remoteColumn}`
      } else {
        relation = `"${relationship.name}" "${relationshipAlias}" ` +
          `JOIN "${targetName}" "${targetAlias}" ` +
          `ON "${targetAlias}".${quote('id')} = "${relationshipAlias}".${remoteColumn} ` +
          `JOIN "Entity" "${rootAlias}" ON "${rootAlias}".${quote('id')} = "${targetAlias}".${quote('id')}`
      }
      condition = `"${relationshipAlias}".${quote(`${local.field}.id`)} = ` +
        `"${parentAlias}".${quote('id')}`
      parentId = `"${relationshipAlias}".${quote(`${local.field}.id`)}`
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
    const collection = this.root.collections.get(name)
    if (!collection) return undefined
    const plan = this.#collectionPlan(collection, this.root.baseAlias, name)
    this.#consume(plan.work)
    const relationship = plan.collection.kind === 'relationship' ? plan.collection.relationship : undefined
    const relationshipAlias = plan.relationshipAlias
    const condition = plan.condition
    this.#countFields.set(
      `${name}.$count`,
      this.#collectionCountExpression(plan, `${name}.$count`),
    )
    const context: EntityContext = plan.target === undefined
      ? rootContext(this.#entities, plan.rootAlias)
      : targetContext(this.#entities, plan.target, plan.targetAlias as string, plan.rootAlias)
    const expressions = new Map<string, string>()
    const identities = new Set<string>()
    const resolved = new Map<string, QueryFieldDefinition>()
    const joins: string[] = []
    const sink: FilterJoinScope = {
      alias: prefix => this.#nextAlias(prefix),
      cache: new Map(),
      consume: units => this.#consume(units),
      join: sql => joins.push(sql),
    }
    const resolve = (path: string): QueryFieldDefinition => {
      const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
      const cachedField = resolved.get(normalized)
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
          const field: ScalarFieldDefinition = { ...property, name: path }
          resolved.set(path, field)
          expressions.set(path, `"${relationshipAlias}".${quote(property.name)}`)
          return field
        }
      }
      const segments = path.split('.')
      if (segments.some(segment => segment.length === 0)) throw new Error(`Invalid filter path "${path}"`)
      const result = this.#resolveFilterPath(context, segments, path, '', 0, sink)
      resolved.set(path, result.field)
      expressions.set(path, result.expression)
      if (result.identity) identities.add(path)
      return result.field
    }
    const scope: CollectionScope = {
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
    this.#collectionScopes.set(name, scope)
    return scope
  }

  /**
   * Build count SQL metadata for one collection plan.
   * @param plan - Reusable collection relation plan.
   * @param key - Stable physical count path.
   * @returns Count expression and canonical existence forms.
   */
  #collectionCountExpression(plan: CollectionRelationPlan, key: string): CountExpression {
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
    const count: CountExpression = {
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
    if (this.root.collections.has(name)) return undefined
    try {
      const field = this.filterField(name)
      if (field.type !== FieldType.Array) return undefined
      return {
        consume: units => this.#consume(units),
        expression: this.expression(field),
        field,
        member: arrayItemField(field),
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
  filterCount(name: string): CountExpression | undefined {
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
    if (!this.#countFields.has(name)) this.#filterExpressions.set(name, resolved.expression)
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
    const name = segments[0]
    if (name === undefined) throw new Error('Query field path cannot be empty')
    const rest = segments.slice(1)
    const path = [...node.path, ...segments].join('.')
    if (rest.length === 1 && rest[0] === '$count') {
      const collection = node.context.collections.get(name)
      if (collection) {
        const key = collectionKey(node.path, collection.name)
        const plan = this.#collectionPlan(collection, node.context.baseAlias, key)
        this.#consume(plan.work)
        const count = this.#collectionCountExpression(plan, path)
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
      if (rest.length > 0) {
        if (
          collection.kind === 'inverse'
          && rest[0] === collection.association.forward.name
        ) {
          throw new Error(`Reciprocal reference backtracking "${path}"`)
        }
        throw new Error(
          `Cannot traverse collection field "${node.context.definition.name}.${segments.join('.')}"`,
        )
      }
      this.#addCollection(node, collection)
      return
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
  #addCollection(node: ProjectionNode, collection: DerivedCollectionDefinition): void {
    if (node.collectionNames.has(collection.name)) return
    const key = collectionKey(node.path, collection.name)
    const config = this.#collections?.[key]
    const limit = config?.limit ?? 3
    const offset = config?.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Collection "${key}" limit must be a positive integer`)
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Collection "${key}" offset must be a non-negative integer`)
    }
    let relationship: {
      readonly fields: readonly RelationshipFieldDefinition[],
      readonly name: string,
    } | undefined
    if (collection.kind === 'inverse') {
      if (config?.relationshipFields !== undefined) {
        throw new Error(
          `Collection "${collection.name}" is an inverse navigation and does not accept relationshipFields`,
        )
      }
    } else {
      relationship = {
        fields: this.#relationshipFields(collection, config?.relationshipFields),
        name: collection.relationship.name,
      }
    }
    const plan = this.#collectionPlan(collection, node.context.baseAlias, key)
    this.#consume(plan.work)
    this.#addCollectionColumns(
      node,
      collection,
      plan.rootAlias,
      plan.relation,
      plan.condition,
      `${plan.rootAlias}.${quote('id')}`,
      limit,
      offset,
      relationship ? { ...relationship, relationshipAlias: plan.relationshipAlias as string } : undefined,
    )
    node.collectionNames.add(collection.name)
    this.#selectedCollectionKeys.add(key)
  }

  /**
   * Validate selected relationship properties for one navigation.
   * @param collection - Relationship-backed navigation.
   * @param names - Requested direct property names.
   * @returns Selected relationship fields in request order.
   */
  #relationshipFields(
    collection: RelationshipDerivedCollectionDefinition,
    names: readonly string[] | undefined,
  ): readonly RelationshipFieldDefinition[] {
    if (names === undefined) return []
    if (!Array.isArray(names)) {
      throw new Error(`Collection "${collection.name}" relationshipFields must be an array`)
    }
    const result: RelationshipFieldDefinition[] = []
    const seen = new Set<string>()
    for (const name of names) {
      if (typeof name !== 'string') {
        throw new Error(`Collection "${collection.name}" relationshipFields must contain strings`)
      }
      if (seen.has(name)) continue
      const field = collection.relationship.fields.find(candidate => candidate.name === name)
      if (!field) {
        throw new Error(
          `Unknown relationship field "${collection.relationship.name}.${name}" ` +
          `for collection "${collection.name}"`,
        )
      }
      if (field.type === FieldType.Array || field.type === FieldType.JSON) {
        throw new Error(
          `Relationship field "${collection.relationship.name}.${name}" is not a scalar property`,
        )
      }
      seen.add(name)
      result.push(field)
    }
    return result
  }

  /**
   * Add collection count and preview columns using correlated subqueries.
   * @param node - Root projection occurrence.
   * @param collection - Derived collection navigation.
   * @param targetRoot - Target root alias inside the collection relation.
   * @param relation - Collection relation SQL.
   * @param condition - Correlated relation condition.
   * @param orderBy - Stable collection ordering expression.
   * @param limit - Preview row limit.
   * @param offset - Preview row offset.
   * @param relationship - Relationship context; its fields are nested under its lowercased name.
   * @param relationship.fields - Selected scalar relationship properties.
   * @param relationship.name - Relationship name used as the nested result property.
   * @param relationship.relationshipAlias - Relationship table alias.
   */
  #addCollectionColumns(
    node: ProjectionNode,
    collection: DerivedCollectionDefinition,
    targetRoot: string,
    relation: string,
    condition: string,
    orderBy: string,
    limit: number,
    offset: number,
    relationship?: {
      readonly fields: readonly RelationshipFieldDefinition[],
      readonly name: string,
      readonly relationshipAlias: string,
    },
  ): void {
    this.#consume(2 + (relationship?.fields.length ?? 0))
    const aliasKey = columnAlias(node.path, collection.name)
    const itemsAlias = `${aliasKey}__items`
    const totalAlias = `${aliasKey}__total`
    const remainingAlias = `${aliasKey}__remaining`
    const items = this.#bind(limit)
    const itemOffset = this.#bind(offset)
    const remainingOffset = this.#bind(offset + limit)
    const countAlias = this.#nextAlias('c')
    this.joins.push(
      `LEFT JOIN LATERAL (SELECT count(*)::int AS "total" FROM ${relation} WHERE ${condition}) ` +
      `"${countAlias}" ON TRUE`,
    )
    const relationshipColumns = (relationship?.fields ?? []).map(field => (
      `"${relationship.relationshipAlias}".${quote(field.name)} AS ${quote(`relationship__${field.name}`)}`
    ))
    const relationshipObject = relationship && relationship.fields.length > 0
      ? `, ${quoteLiteral(lowerFirst(relationship.name))}, json_build_object(${relationship.fields.map(field => (
        `${quoteLiteral(field.name)}, collection_page.${quote(`relationship__${field.name}`)}`
      )).join(', ')})`
      : ''
    this.columns.push(
      'COALESCE((' +
      'SELECT json_agg(json_build_object(\'id\', collection_page."id", \'name\', collection_page."name", ' +
      `'entity', collection_page."entity"${relationshipObject}) ` +
      'ORDER BY collection_page."order_by", collection_page."id") ' +
      `FROM (SELECT "${targetRoot}"."id" AS "id", "${targetRoot}"."name" AS "name", ` +
      `"${targetRoot}"."entity" AS "entity", ${orderBy} AS "order_by"` +
      `${relationshipColumns.length > 0 ? `, ${relationshipColumns.join(', ')}` : ''} ` +
      `FROM ${relation} ` +
      `WHERE ${condition} ORDER BY ${orderBy} ASC, "${targetRoot}"."id" ASC ` +
      `LIMIT ${items} OFFSET ${itemOffset}) AS collection_page), ` +
      `'[]'::json) AS "${itemsAlias}"`,
      `"${countAlias}"."total" AS "${totalAlias}"`,
      `GREATEST("${countAlias}"."total" - ${remainingOffset}, 0) AS "${remainingAlias}"`,
    )
    node.collections.push({ itemsAlias, name: collection.name, remainingAlias, totalAlias })
  }

  /**
   * Bind one collection-subquery value after predicate bindings.
   * @param value - Value to bind.
   * @returns Placeholder.
   */
  #bind(value: unknown): string {
    this.values.push(value)
    return `$${this.#valueStart + this.values.length - 1}`
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
      collectionNames: new Set(),
      collections: [],
      context,
      fieldNames: new Set(),
      fields: [],
      path,
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
    if (this.#work > MAX_PROJECTION_WORK) {
      throw new Error(`Query projection exceeds the maximum graph work budget of ${MAX_PROJECTION_WORK}`)
    }
  }

  /**
   * Allocate a unique table alias.
   * @param prefix - Alias prefix.
   * @returns Unique alias.
   */
  #nextAlias(prefix: string): string {
    this.#alias += 1
    return `${prefix}${this.#alias}`
  }
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
  const projection = new QueryProjection(entities, definition, options.collections)
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
  const scope: QueryScope = {
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

  const leaves: string[] = []
  if (definition.abstract) {
    for (const entity of entities.entities) {
      if (!entity.abstract && descendsFrom(entities, entity, definition.name)) {
        leaves.push(quoteLiteral(entity.name))
      }
    }
  }
  const leafFilter = leaves.length === 0
    ? 'FALSE'
    : `${projection.root.rootAlias}."entity" IN (${leaves.join(', ')})`
  const conditions = [
    ...(definition.abstract ? [leafFilter] : []),
    ...(predicate.sql === '' ? [] : [predicate.sql.replace(/^WHERE /u, '')]),
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
    collections: new Map(entities.collections('Entity').map(collection => [collection.name, collection])),
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
    collections: new Map(definition.collections.map(collection => [collection.name, collection])),
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
  const leaves = entities.entities.filter(entity => (
    !entity.abstract && descendsFrom(entities, entity, definition.name)
  ))
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
  const leaves = entities.entities.filter(entity => !entity.abstract)
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
  if (field.type === FieldType.Array) {
    return `Array:${field.items.type}:${field.items.format ?? ''}`
  }
  if (field.type === FieldType.Entity) return `Entity:${field.target}`
  if (field.type === FieldType.Inverse) return `Inverse:${field.target}:${field.inverse}:${field.cardinality}`
  return `${field.type}:${field.format ?? ''}`
}

/**
 * Whether an entity descends from an ancestor.
 * @param entities - Canonical definitions.
 * @param entity - Candidate entity.
 * @param ancestor - Ancestor name.
 * @returns `true` when the entity is the ancestor or a descendant.
 */
function descendsFrom(
  entities: EntityDefinitions,
  entity: EntityDefinition,
  ancestor: string,
): boolean {
  let current: string | undefined = entity.name
  while (current !== undefined) {
    if (current === ancestor) return true
    current = entities.entity(current)?.parent
    if (current === 'Entity') return false
  }
  return false
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
  for (const collection of node.collections) {
    result[collection.name] = hydrateCollection(row, collection)
  }
  for (const reference of node.references) {
    result[reference.name] = hydrateReferenceVariants(row, reference)
  }
  return result
}

/**
 * Hydrate one collection envelope.
 * @param row - Flat SQL row.
 * @param collection - Collection projection metadata.
 * @returns The `{ items, total, remaining }` envelope.
 */
function hydrateCollection(
  row: Record<string, unknown>,
  collection: CollectionProjection,
): { items: unknown[], remaining: number, total: number } {
  const raw = row[collection.itemsAlias]
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? JSON.parse(raw) as unknown[]
      : []
  return {
    items,
    remaining: Number(row[collection.remainingAlias] ?? 0),
    total: Number(row[collection.totalAlias] ?? 0),
  }
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
  for (const collection of node.collections) {
    result[collection.name] = hydrateCollection(row, collection)
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
