import type { DerivedCollectionDefinition, EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, InverseDerivedCollectionDefinition, RelationshipDerivedCollectionDefinition, RelationshipFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'
import type { Filter } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { OrderBy, QueryScope } from './SQL'
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
  /** Canonical reference-edge identities aligned with `nodes`. */
  readonly edges: readonly string[],
  /** Output reference field name. */
  readonly name: string,
  /** Variant target nodes; a normal reference has exactly one. */
  readonly nodes: readonly ProjectionNode[],
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
  /** Collection configuration overrides. */
  readonly #collections: Readonly<Record<string, {
    readonly limit?: number,
    readonly offset?: number,
    readonly relationshipFields?: readonly string[],
  }>> | undefined
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
    for (const field of fields) this.#addPath(root, field.split('.'), new Set(), 0)
    for (const name of Object.keys(this.#collections ?? {})) {
      if (!root.collectionNames.has(name)) {
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
    const work = fields.reduce((total, field) => total + field.split('.').length, collections.length)
    if (work > MAX_PROJECTION_WORK) {
      throw new Error(
        `Query projection exceeds the maximum graph work budget of ${MAX_PROJECTION_WORK}`,
      )
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
  expression(field: ScalarFieldDefinition): string {
    const effective = this.root.effective.get(field.name)
    if (!effective) throw new Error(`Unknown field "${this.root.definition.name}.${field.name}"`)
    return this.#expression(this.root, effective, false)
  }

  /**
   * Add one projection path below an occurrence.
   * @param node - Current occurrence.
   * @param segments - Remaining path segments.
   * @param references - Reference field names already traversed.
   * @param depth - Number of reference hops already traversed.
   */
  #addPath(
    node: ProjectionNode,
    segments: readonly string[],
    references: ReadonlySet<string>,
    depth: number,
  ): void {
    const name = segments[0]
    if (name === undefined) throw new Error('Query field path cannot be empty')
    const rest = segments.slice(1)
    const collection = node.context.collections.get(name)
    if (collection) {
      if (rest.length > 0) {
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
        const path = [...node.path, ...segments].join('.')
        const edge = referenceEdge(effective)
        if (references.has(edge)) throw new Error(`Repeated reference expansion "${path}"`)
        if (depth >= MAX_REFERENCE_DEPTH) {
          throw new Error(`Reference path "${path}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
        }
        let reference = node.referenceNames.get(name)
        if (!reference) {
          reference = { edges: [edge], name, nodes: [this.#reference(node, effective)] }
          node.referenceNames.set(name, reference)
          node.references.push(reference)
        }
        if (rest.length > 0) {
          for (const [index, child] of reference.nodes.entries()) {
            this.#addPath(
              child,
              rest,
              new Set([...references, reference.edges[index] ?? edge]),
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
        const path = [...node.path, ...segments].join('.')
        const edges = descendant.variants.map(variant => referenceEdge(variant.field))
        if (edges.some(edge => references.has(edge))) {
          throw new Error(`Repeated reference expansion "${path}"`)
        }
        if (depth >= MAX_REFERENCE_DEPTH) {
          throw new Error(`Reference path "${path}" exceeds the maximum depth of ${MAX_REFERENCE_DEPTH}`)
        }
        let reference = node.referenceNames.get(name)
        if (!reference) {
          const nodes = descendant.variants.map((variant, index) => {
            const sourceAlias = this.#ownerAlias(node.context, variant.owner, true)
            return this.#target(
              variant.field,
              [...node.path, `${name}__v${index}`],
              sourceAlias,
            )
          })
          reference = { edges, name, nodes }
          node.referenceNames.set(name, reference)
          node.references.push(reference)
        }
        if (rest.length > 0) {
          for (const [index, child] of reference.nodes.entries()) {
            this.#addPath(
              child,
              rest,
              new Set([...references, reference.edges[index] ?? name]),
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
    let context: EntityContext
    if (field.target === 'Entity') {
      const rootAlias = this.#nextAlias('r')
      this.joins.push(
        `LEFT JOIN "Entity" "${rootAlias}" ON ` +
        `"${rootAlias}"."id" = ${sourceAlias}.${quote(field.column)}`,
      )
      context = rootContext(this.#entities, rootAlias)
    } else {
      const target = this.#entities.entity(field.target)
      if (!target) throw new Error(`Unknown target entity "${field.target}"`)
      const baseAlias = this.#nextAlias('b')
      const rootAlias = this.#nextAlias('r')
      this.joins.push(
        `LEFT JOIN "${target.name}" "${baseAlias}" ON ` +
        `"${baseAlias}"."id" = ${sourceAlias}.${quote(field.column)}`,
      )
      this.joins.push(
        `LEFT JOIN "Entity" "${rootAlias}" ON "${rootAlias}"."id" = "${baseAlias}"."id"`,
      )
      context = targetContext(this.#entities, target, baseAlias, rootAlias)
    }
    const child = this.#node(context, path)
    this.#identity(child)
    return child
  }

  /**
   * Add one root collection envelope projection.
   * @param node - Projection occurrence.
   * @param collection - Derived collection navigation.
   */
  #addCollection(node: ProjectionNode, collection: DerivedCollectionDefinition): void {
    if (node.path.length > 0) {
      throw new Error('Nested collection projections are not supported yet')
    }
    if (node.collectionNames.has(collection.name)) return
    const config = this.#collections?.[collection.name]
    const limit = config?.limit ?? 3
    const offset = config?.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Collection "${collection.name}" limit must be a positive integer`)
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Collection "${collection.name}" offset must be a non-negative integer`)
    }
    if (collection.kind === 'inverse') {
      if (config?.relationshipFields !== undefined) {
        throw new Error(
          `Collection "${collection.name}" is an inverse navigation and does not accept relationshipFields`,
        )
      }
      this.#addInverseCollection(node, collection, limit, offset)
    } else {
      const fields = this.#relationshipFields(collection, config?.relationshipFields)
      this.#addRelationshipCollection(node, collection, fields, limit, offset)
    }
    node.collectionNames.add(collection.name)
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
   * Add an inverse-collection subquery.
   * @param node - Root projection occurrence.
   * @param collection - Inverse navigation.
   * @param limit - Preview row limit.
   * @param offset - Preview row offset.
   */
  #addInverseCollection(
    node: ProjectionNode,
    collection: InverseDerivedCollectionDefinition,
    limit: number,
    offset: number,
  ): void {
    const target = collection.target
    if (target !== 'Entity' && !this.#entities.entity(target)) {
      throw new Error(`Unknown target entity "${target}"`)
    }
    const relation = target === 'Entity'
      ? '"Entity" "cr"'
      : `"${target}" "ct" JOIN "Entity" "cr" ON "cr"."id" = "ct"."id"`
    const condition = target === 'Entity'
      ? `"cr"."id" = "${node.context.baseAlias}"."id"`
      : `"ct".${quote(collection.reference.column)} = "${node.context.baseAlias}"."id"`
    this.#addCollectionColumns(node, collection, 'cr', relation, condition, '"cr"."id"', limit, offset)
  }

  /**
   * Add a relationship-backed collection subquery.
   * @param node - Root projection occurrence.
   * @param collection - Relationship navigation.
   * @param fields - Selected relationship properties.
   * @param limit - Preview row limit.
   * @param offset - Preview row offset.
   */
  #addRelationshipCollection(
    node: ProjectionNode,
    collection: RelationshipDerivedCollectionDefinition,
    fields: readonly RelationshipFieldDefinition[],
    limit: number,
    offset: number,
  ): void {
    const relationship = collection.relationship
    const local = relationship.between[collection.endpoint]
    const remote = relationship.between[collection.endpoint === 0 ? 1 : 0]
    const target = collection.target
    if (target !== 'Entity' && !this.#entities.entity(target)) {
      throw new Error(`Unknown target entity "${target}"`)
    }
    const source = `"${relationship.name}" "cj"`
    const relation = target === 'Entity'
      ? `${source} JOIN "Entity" "cr" ON "cr"."id" = "cj".${quote(`${remote.field}.id`)}`
      : `${source} JOIN "${target}" "ct" ON "ct"."id" = "cj".${quote(`${remote.field}.id`)} ` +
        'JOIN "Entity" "cr" ON "cr"."id" = "ct"."id"'
    const condition = `"cj".${quote(`${local.field}.id`)} = "${node.context.baseAlias}"."id"`
    this.#addCollectionColumns(
      node,
      collection,
      'cr',
      relation,
      condition,
      '"cr"."id"',
      limit,
      offset,
      { fields, name: relationship.name },
    )
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
    },
  ): void {
    const itemsAlias = `${collection.name}__items`
    const totalAlias = `${collection.name}__total`
    const remainingAlias = `${collection.name}__remaining`
    const items = this.#bind(limit)
    const itemOffset = this.#bind(offset)
    const remainingOffset = this.#bind(offset + limit)
    const countAlias = this.#nextAlias('c')
    this.joins.push(
      `LEFT JOIN LATERAL (SELECT count(*)::int AS "total" FROM ${relation} WHERE ${condition}) ` +
      `"${countAlias}" ON TRUE`,
    )
    const relationshipColumns = (relationship?.fields ?? []).map(field => (
      `"cj".${quote(field.name)} AS ${quote(`relationship__${field.name}`)}`
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
   * @returns Qualified SQL expression.
   */
  #expression(context: EntityContext, field: EffectiveFieldDefinition, forceLeft: boolean): string {
    if (field.name === 'id') return `${context.baseAlias}.${quote(field.name)}`
    if (field.owner === 'Entity') {
      return `${this.#ensureRoot(context)}.${quote(field.name)}`
    }
    return `${this.#ownerAlias(context, field.owner, forceLeft)}.${quote(field.name)}`
  }

  /**
   * Ensure a universal root join exists for one occurrence.
   * @param context - Entity occurrence.
   * @returns Root table alias.
   */
  #ensureRoot(context: EntityContext): string {
    if (context.rootOnly || context.rootJoined) return context.rootAlias
    const join = context.isTarget ? 'LEFT JOIN' : 'JOIN'
    this.joins.push(
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
   * @returns Owner table alias.
   */
  #ownerAlias(context: EntityContext, owner: string, forceLeft: boolean): string {
    if (owner === 'Entity') return this.#ensureRoot(context)
    if (owner === context.definition.name) return context.baseAlias
    const existing = context.ownerAliases.get(owner)
    if (existing) return existing
    const alias = this.#nextAlias('o')
    const join = context.isTarget || forceLeft ? 'LEFT JOIN' : 'JOIN'
    this.joins.push(
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
  const field = (name: string): ScalarFieldDefinition => {
    const value = projection.root.effective.get(name)
    if (!value) throw new Error(`Unknown field "${definition.name}.${name}"`)
    if (value.type === FieldType.Entity) {
      throw new Error(
        `Query field "${definition.name}.${name}" is an entity reference; ` +
        'references cannot be used in predicates or ordering',
      )
    }
    if (value.type === FieldType.Array) {
      throw new Error(
        `Query field "${definition.name}.${name}" is an array; ` +
        'array fields cannot be used in predicates or ordering',
      )
    }
    if (value.type === FieldType.JSON) {
      throw new Error(
        `Query field "${definition.name}.${name}" is JSON; ` +
        'JSON fields cannot be used in predicates or ordering',
      )
    }
    return value
  }
  const scope: QueryScope = {
    definition: synthetic,
    expression: value => projection.expression(value),
    field,
  }
  const where = typeof options.where === 'string'
    ? QueryNormalizer.normalize(synthetic, options.where) ?? undefined
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
  for (const reference of node.references) {
    result[reference.name] = hydrateReferenceVariants(row, reference)
  }
  return result
}

/**
 * Build the canonical identity of one singular reference edge.
 * @param field - Effective reference field.
 * @returns Owner-qualified edge identity.
 */
function referenceEdge(field: EffectiveFieldDefinition): string {
  return `${field.owner}\u0000${field.name}`
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
