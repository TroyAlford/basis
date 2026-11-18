import type { DerivedCollectionDefinition, EntityDefinition, EntityReferenceFieldDefinition, RelationshipDefinition, RelationshipEndpointDefinition } from './EntityDefinitions'
import { identityDefinition, relationshipView } from './EntityDefinitions'
import type { Filter } from './Predicate'

/** Physical adapter that retrieves a collection's source rows. */
export type CollectionSourceAdapter =
  | {
    /** Discriminator for inverse-reference sources. */
    readonly kind: 'inverse',
    /** Forward reference stored on the related row. */
    readonly reference: EntityReferenceFieldDefinition,
  }
  | {
    /** Discriminator for named-relationship sources. */
    readonly kind: 'relationship',
    /** Named relationship owning the source rows. */
    readonly relationship: RelationshipDefinition,
    /** Endpoint whose column carries the related result identity. */
    readonly remote?: RelationshipEndpointDefinition,
  }

/** Correlation between a collection source row and its owning identity. */
export interface CollectionOwnerCorrelation {
  /** Logical column carrying the owning identity on the source row. */
  readonly column: string,
  /** Relationship endpoint that owns the correlation, when relationship-backed. */
  readonly endpoint?: RelationshipEndpointDefinition,
}

/** Identity shared by one collection's results. */
export type CollectionResultIdentity =
  | {
    /** Result is a distinct entity identity. */
    readonly kind: 'entity',
  }
  | {
    /** Endpoint columns forming the composite record identity. */
    readonly columns: readonly string[],
    /** Result is a relationship record identified by its complete endpoint tuple. */
    readonly kind: 'record',
  }

/** Metadata view exposed to projection, filtering and authorization consumers. */
export type CollectionTargetView =
  | {
    /** Projected entity definition. */
    readonly definition: EntityDefinition,
    /** Result is a distinct entity. */
    readonly kind: 'entity',
  }
  | {
    /** Relationship record view. */
    readonly definition: EntityDefinition,
    /** Result is a relationship record. */
    readonly kind: 'record',
    /** Named relationship providing the record shape. */
    readonly relationship: RelationshipDefinition,
  }

/** Authored predicates applied to collection source rows. */
export interface CollectionSourcePredicates {
  /**
   * Canonical predicates relative to the source row.
   *
   * Literal operands remain embedded in the canonical filter tree; the shared
   * SQL binder owns placeholder creation and parameter rebasing.
   */
  readonly filters: readonly Filter[],
}

/**
 * One canonical collection relation.
 *
 * Every collection operation resolves this shape once, then consumes the same
 * source, owner correlation, predicates, identity, result type and target view.
 * Source adapters differ only in how physical rows are retrieved.
 */
export interface ResolvedCollectionRelation {
  /** Collection navigation this relation was resolved from. */
  readonly collection: DerivedCollectionDefinition,
  /** Identity used to deduplicate and count results. */
  readonly identity: CollectionResultIdentity,
  /** Correlation to the owning entity identity. */
  readonly owner: CollectionOwnerCorrelation,
  /** Authored predicates applied to source rows. */
  readonly predicates: CollectionSourcePredicates,
  /** Whether the result is a projected entity or a relationship record. */
  readonly resultType: 'entity' | 'record',
  /** Physical row-retrieval adapter. */
  readonly source: CollectionSourceAdapter,
  /** Projection and filtering view for the result. */
  readonly target: CollectionTargetView,
}

/**
 * Resolve one derived collection navigation into its canonical relation.
 *
 * The resolver reuses the collection metadata already normalized from the
 * authored `via` path; it never parses or reinterprets that grammar.
 * @param collection - Derived collection navigation.
 * @param resolveEntity - Resolve one entity by name.
 * @returns The canonical collection relation.
 * @throws {Error} When a projected target entity is not declared.
 */
export function resolveCollectionRelation(
  collection: DerivedCollectionDefinition,
  resolveEntity: (name: string) => EntityDefinition | undefined,
): ResolvedCollectionRelation {
  if (collection.kind === 'inverse') {
    return {
      collection,
      identity: { kind: 'entity' },
      owner: { column: collection.reference.column },
      predicates: { filters: [] },
      resultType: 'entity',
      source: {
        kind: 'inverse',
        reference: collection.reference,
      },
      target: { definition: entityView(collection.target, resolveEntity), kind: 'entity' },
    }
  }

  if (collection.kind === 'relationship') {
    const owner = collection.relationship.between[collection.endpoint]
    const remote = collection.relationship.between[collection.endpoint === 0 ? 1 : 0]
    return {
      collection,
      identity: { kind: 'entity' },
      owner: { column: `${owner.field}.id`, endpoint: owner },
      predicates: { filters: [] },
      resultType: 'entity',
      source: {
        kind: 'relationship',
        relationship: collection.relationship,
        remote,
      },
      target: { definition: entityView(collection.target, resolveEntity), kind: 'entity' },
    }
  }

  const targetEndpoint = collection.targetEndpoint
  const remote = targetEndpoint ?? (
    collection.relationship.between.length === 2
      ? collection.relationship.between.find(endpoint => endpoint !== collection.ownerEndpoint)
      : undefined
  )
  const recordColumns = collection.relationship.between.map(endpoint => `${endpoint.field}.id`)
  const recordView = relationshipView(collection.relationship)
  const identity: CollectionResultIdentity = targetEndpoint === undefined
    ? { columns: recordColumns, kind: 'record' }
    : { kind: 'entity' }
  const target: CollectionTargetView = targetEndpoint === undefined
    ? { definition: recordView, kind: 'record', relationship: collection.relationship }
    : { definition: entityView(targetEndpoint.target, resolveEntity), kind: 'entity' }
  return {
    collection,
    identity,
    owner: {
      column: `${collection.ownerEndpoint.field}.id`,
      endpoint: collection.ownerEndpoint,
    },
    predicates: {
      filters: collection.viaFilter === undefined ? [] : [collection.viaFilter],
    },
    resultType: targetEndpoint === undefined ? 'record' : 'entity',
    source: {
      kind: 'relationship',
      ...(remote === undefined ? {} : { remote }),
      relationship: collection.relationship,
    },
    target,
  }
}

/**
 * Resolve one entity view by name, including the universal identity root.
 * @param name - Entity name.
 * @param resolve - Entity lookup.
 * @returns The resolved entity view.
 * @throws {Error} When the entity is not declared.
 */
function entityView(
  name: string,
  resolve: (value: string) => EntityDefinition | undefined,
): EntityDefinition {
  if (name === 'Entity') return identityDefinition()
  const entity = resolve(name)
  if (!entity) throw new Error(`Collection target entity "${name}" is not declared`)
  return entity
}
