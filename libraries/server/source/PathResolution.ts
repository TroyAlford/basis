import type { DerivedCollectionDefinition, EffectiveFieldDefinition, EntityDefinition, EntityReferenceFieldDefinition, FieldDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'

/** Maximum singular-reference hops in one Graph path. */
export const MAX_GRAPH_PATH_DEPTH = 8

/** One canonical path-resolution failure. */
export type PathFailure =
  | { readonly entity: string, readonly kind: 'unknown', readonly path: string }
  | { readonly entity: string, readonly kind: 'non-reference', readonly path: string, readonly segment: string }
  | { readonly entity: string, readonly kind: 'incompatible', readonly path: string, readonly segment: string }
  | { readonly kind: 'depth', readonly path: string }

/** Entity lookup used while resolving a path. */
export interface PathResolutionOptions {
  /** Return concrete descendants, when the caller has the full definition model. */
  readonly concreteDescendants?: (name: string) => readonly EntityDefinition[],
  /** Resolve one entity by name. */
  readonly resolve: (name: string) => EntityDefinition | undefined,
}

/** The minimal canonical definitions required to resolve a Graph path. */
export interface GraphPathDefinitions {
  /** Return concrete descendants in canonical order. */
  concreteDescendants(name: string): readonly EntityDefinition[],
  /** Resolve one entity by name. */
  entity(name: string): EntityDefinition | undefined,
}

/**
 * Adapt caller lookups to the canonical path-resolution definitions.
 * @param options - Caller entity and descendant lookups.
 * @returns Canonical resolver definitions.
 */
function graphPathDefinitions(options: PathResolutionOptions): GraphPathDefinitions {
  return {
    concreteDescendants: name => options.concreteDescendants?.(name) ?? [],
    entity: name => options.resolve(name),
  }
}

/** One traversed singular reference. */
export interface FieldPathHop {
  /** Reference field that was traversed. */
  readonly field: EntityReferenceFieldDefinition & { readonly owner: string },
  /** Logical path to the reference. */
  readonly path: string,
}

/** One resolved field or reference path. */
export interface FieldPathResolution {
  /** The terminal value field exposed to predicates. */
  readonly field: QueryFieldDefinition,
  /** Singular references traversed before the terminal field. */
  readonly hops: readonly FieldPathHop[],
  /** Whether the terminal is a reference identity. */
  readonly identity: boolean,
  /** Normalized path segments. */
  readonly segments: readonly string[],
  /** The terminal effective field, including a reference whose identity was selected. */
  readonly terminal: EffectiveFieldDefinition,
}

/** One resolved collection path. */
export interface CollectionPathResolution {
  /** Collection navigation. */
  readonly collection: DerivedCollectionDefinition,
  /** Entity exposing the collection. */
  readonly owner: EntityDefinition,
  /** Singular-reference prefix before the collection, or an empty string. */
  readonly prefix: string,
}

/** One resolved collection member field. */
export interface CollectionMemberResolution {
  /** Member field exposed to the collection predicate. */
  readonly field: QueryFieldDefinition,
  /** Whether the member is a named-relationship-owned property. */
  readonly relationshipProperty: boolean,
}

/**
 * Resolve one field or dotted reference path through the canonical Graph model.
 * @param entity - Entity where the path starts.
 * @param path - Logical field or dotted reference path.
 * @param options - Entity lookup.
 * @returns The resolved terminal field, or a failure.
 */
export function resolveFieldPath(
  entity: EntityDefinition,
  path: string,
  options: PathResolutionOptions,
): FieldPathResolution | PathFailure {
  const resolved = resolveGraphPath(graphPathDefinitions(options), entity, path)
  if (!('branches' in resolved)) return resolved
  if (resolved.kind !== 'field') {
    return { entity: entity.name, kind: 'non-reference', path, segment: path.split('.').pop() ?? path }
  }
  const branch = resolved.branches[0]
  if (branch === undefined) return { entity: entity.name, kind: 'unknown', path }
  const hops: FieldPathHop[] = []
  let logical = ''
  let terminal: EffectiveFieldDefinition | undefined
  let identityField: EffectiveFieldDefinition | undefined
  for (const step of branch.steps) {
    if (step.kind === 'reference') {
      logical = logical === '' ? step.field.name : `${logical}.${step.field.name}`
      if (terminal === undefined) hops.push({ field: step.field, path: logical })
      identityField = step.field
      terminal = undefined
      continue
    }
    if (step.kind === 'field') terminal = step.field
  }
  const terminalField = terminal ?? identityField ?? identityDefinition().effectiveFields
    .find(field => field.name === (path.split('.').pop() ?? 'id'))
  if (terminalField === undefined) return { entity: entity.name, kind: 'unknown', path }
  return {
    field: resolved.field,
    hops,
    identity: resolved.identity,
    segments: path.split('.'),
    terminal: terminalField,
  }
}

/**
 * Resolve one collection navigation, including composed reference prefixes.
 * @param entity - Entity where the path starts.
 * @param path - Collection name or dotted reference path.
 * @param options - Entity lookup.
 * @returns The resolved collection, or a failure.
 */
export function resolveCollectionPath(
  entity: EntityDefinition,
  path: string,
  options: PathResolutionOptions,
): CollectionPathResolution | PathFailure | undefined {
  const resolved = resolveGraphPath(graphPathDefinitions(options), entity, path)
  if (!('branches' in resolved)) {
    if (resolved.kind === 'unknown') return undefined
    return resolved
  }
  if (resolved.kind !== 'collection') return undefined
  const branch = resolved.branches[0]
  if (branch === undefined) return undefined
  const collectionStep = branch.steps.at(-1)
  if (collectionStep?.kind !== 'collection') return undefined
  const references = branch.steps.filter(step => step.kind === 'reference')
  const prefix = references.map(step => (step.kind === 'reference' ? step.field.name : '')).join('.')
  let owner = entity
  for (const step of references) {
    if (step.kind !== 'reference') continue
    const target = step.field.target === 'Entity' ? identityDefinition() : options.resolve(step.field.target)
    if (target === undefined) return { entity: owner.name, kind: 'unknown', path }
    owner = target
  }
  return { collection: collectionStep.collection, owner, prefix }
}

/**
 * Resolve one member field inside a collection predicate.
 * @param collection - Collection navigation.
 * @param target - Collection target entity view.
 * @param path - Member path or relationship-owned property.
 * @param options - Entity lookup.
 * @returns The resolved member field, or a failure.
 */
export function resolveCollectionMember(
  collection: DerivedCollectionDefinition,
  target: EntityDefinition,
  path: string,
  options: PathResolutionOptions,
): CollectionMemberResolution | PathFailure {
  const normalized = path === '@' ? 'id' : path.startsWith('@.') ? path.slice(2) : path
  const relationship = 'relationship' in collection ? collection.relationship : undefined
  if (relationship !== undefined) {
    const prefix = `${lowerFirst(relationship.name)}.`
    if (normalized.startsWith(prefix)) {
      const name = normalized.slice(prefix.length)
      const endpoint = relationship.between.find(candidate => candidate.field === name)
      if (endpoint !== undefined) {
        return { field: { name: normalized, type: FieldType.ID }, relationshipProperty: true }
      }
      const field = relationship.fields.find(candidate => candidate.name === name)
      if (!field) return { entity: relationship.name, kind: 'unknown', path: normalized }
      return { field: { ...field, name: normalized }, relationshipProperty: true }
    }
  }
  const resolved = resolveFieldPath(target, normalized, options)
  if ('kind' in resolved) return resolved
  return { field: resolved.field, relationshipProperty: false }
}

/**
 * Normalize a field type to its comparable value family.
 * @param type - Declared field type.
 * @returns The comparable field type.
 */
export function comparableFieldType(type: FieldType): FieldType {
  return type === FieldType.Enum ? FieldType.String : type
}

/**
 * Lower the first character of a name.
 * @param value - Name to lower.
 * @returns The lower-cased name.
 */
function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`
}

/** One descendant-only field declaration group. */
export interface DescendantField {
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
export interface DescendantVariant {
  /** Effective field declaration. */
  readonly field: EffectiveFieldDefinition,
  /** Concrete leaves that expose this declaration. */
  readonly leaves: readonly string[],
  /** Physical owner table. */
  readonly owner: string,
}

/**
 * Build the descendant-only field index for one abstract entity.
 * @param definitions - Canonical entity definitions.
 * @param definitions.concreteDescendants - Concrete descendant lookup.
 * @param definition - Entity being queried.
 * @returns Descendant fields keyed by logical name.
 */
export function descendantFields(
  definitions: { concreteDescendants(name: string): readonly EntityDefinition[] },
  definition: EntityDefinition,
): ReadonlyMap<string, DescendantField> {
  if (!definition.abstract) return new Map()
  const baseNames = new Set(definition.effectiveFields.map(field => field.name))
  return collectDescendantFields(definitions.concreteDescendants(definition.name), baseNames)
}

/**
 * Build the selectable descendant union for the universal `Entity` root.
 * @param definitions - Canonical entity definitions.
 * @param definitions.concreteDescendants - Concrete descendant lookup.
 * @param root - Canonical universal root definition.
 * @returns Leaf-owned fields keyed by logical name.
 */
export function universalDescendantFields(
  definitions: { concreteDescendants(name: string): readonly EntityDefinition[] },
  root: EntityDefinition,
): ReadonlyMap<string, DescendantField> {
  return collectDescendantFields(
    definitions.concreteDescendants('Entity'),
    new Set(root.effectiveFields.map(field => field.name)),
  )
}

/**
 * Group leaf-owned fields into compatible descendant variants.
 * @param leaves - Concrete entities in canonical order.
 * @param baseNames - Field names already supplied by the base/root occurrence.
 * @returns Descendant fields keyed by logical name.
 */
export function collectDescendantFields(
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
  if (field.type === FieldType.Collection) return `Collection:${field.target}:${field.via}`
  if (field.type === FieldType.Inverse) return `Inverse:${field.target}:${field.inverse}:${field.cardinality}`
  return `${field.type}:${field.format ?? ''}`
}

/**
 * Build an abstract entity view with compatible descendant-only fields and
 * the universal Entity discriminator available to path resolution.
 * @param definitions - Canonical entity definitions.
 * @param definitions.concreteDescendants - Concrete descendant lookup.
 * @param entity - Entity to view.
 * @returns The original concrete entity, or an augmented abstract view.
 */
export function abstractEntityView(
  definitions: { concreteDescendants(name: string): readonly EntityDefinition[] },
  entity: EntityDefinition,
): EntityDefinition {
  if (!entity.abstract) return entity
  const fields = [...entity.effectiveFields]
  const names = new Set(fields.map(field => field.name))
  if (!names.has('entity')) {
    const discriminator = identityDefinition().effectiveFields.find(field => field.name === 'entity')
    if (discriminator !== undefined) {
      fields.push(discriminator)
      names.add('entity')
    }
  }
  for (const [name, descendant] of descendantFields(definitions, entity)) {
    if (names.has(name) || descendant.contracts.size > 1 || descendant.variants.length !== 1) continue
    const variant = descendant.variants[0]
    if (variant !== undefined) {
      fields.push(variant.field)
      names.add(name)
    }
  }
  return { ...entity, effectiveFields: fields, fields }
}

/** A concrete-type guard attached to one traversal occurrence. */
export interface ConcreteGuard {
  /** Concrete types for which this branch is valid. */
  readonly leaves: readonly string[],
  /** Index of the source entity occurrence in this traversal. */
  readonly occurrence: number,
}

/** One step in a canonical Graph path traversal. */
export type GraphPathStep =
  | {
    readonly field: EntityReferenceFieldDefinition & { readonly owner: string },
    readonly guard?: ConcreteGuard,
    readonly kind: 'reference',
  }
  | {
    readonly field: EffectiveFieldDefinition,
    readonly guard?: ConcreteGuard,
    readonly kind: 'field',
  }
  | {
    readonly collection: DerivedCollectionDefinition,
    readonly guard?: ConcreteGuard,
    readonly kind: 'collection',
  }

/** One concrete branch of a canonical Graph path. */
export interface GraphPathBranch {
  readonly steps: readonly GraphPathStep[],
}

/** The canonical result of resolving one Graph path. */
export type ResolvedGraphPath =
  | {
    readonly branches: readonly GraphPathBranch[],
    readonly field: QueryFieldDefinition,
    readonly identity: boolean,
    readonly kind: 'field',
  }
  | {
    readonly branches: readonly GraphPathBranch[],
    readonly kind: 'collection',
  }

/**
 * Cast one effective reference field for a traversal step.
 * @param field - Effective reference field.
 * @returns The reference-field step payload.
 */
function referenceStep(field: EffectiveFieldDefinition): Extract<GraphPathStep, { kind: 'reference' }>['field'] {
  return field as EntityReferenceFieldDefinition & { readonly owner: string }
}

/**
 * Resolve one canonical Graph path through concrete descendant branches.
 * @param definitions - Canonical definitions and concrete-descendant lookup.
 * @param start - Entity where traversal starts.
 * @param path - Dotted field, reference, or collection path.
 * @returns The canonical field/collection branches or a failure.
 */
export function resolveGraphPath(
  definitions: GraphPathDefinitions,
  start: EntityDefinition,
  path: string,
): ResolvedGraphPath | PathFailure {
  const segments = path.split('.')
  if (segments.some(segment => segment.length === 0)) {
    return { entity: start.name, kind: 'unknown', path }
  }
  interface State {
    readonly entity: EntityDefinition,
    readonly occurrence: number,
    readonly steps: readonly GraphPathStep[],
  }
  const expand = (state: State, index: number): ResolvedGraphPath | PathFailure => {
    if (index >= segments.length) {
      return {
        branches: [{ steps: state.steps }],
        field: { name: path, type: FieldType.ID },
        identity: true,
        kind: 'field',
      }
    }
    const name = segments[index] as string
    const rest = segments.slice(index + 1)
    const collection = state.entity.collections.find(candidate => candidate.name === name)
    if (collection !== undefined && rest.length === 0) {
      return { branches: [{ steps: [...state.steps, { collection, kind: 'collection' }] }], kind: 'collection' }
    }
    const field = state.entity.effectiveFields.find(candidate => candidate.name === name)
    if (field !== undefined) {
      const ownerField = { ...field, owner: field.owner } as EffectiveFieldDefinition
      if (rest.length === 0) {
        if (field.type === FieldType.Entity) {
          const target = field.target === 'Entity' ? identityDefinition() : definitions.entity(field.target)
          return {
            branches: [{ steps: [...state.steps, { field: referenceStep(ownerField), kind: 'reference' }] }],
            field: {
              ...(target?.idFormat === undefined ? {} : { format: target.idFormat }),
              name: path,
              type: FieldType.ID,
            },
            identity: true,
            kind: 'field',
          }
        }
        return {
          branches: [{ steps: [...state.steps, { field: ownerField, kind: 'field' }] }],
          field: { ...field, name: path } as QueryFieldDefinition,
          identity: false,
          kind: 'field',
        }
      }
      if (field.type !== FieldType.Entity) {
        return { entity: state.entity.name, kind: 'non-reference', path, segment: name }
      }
      if (rest.length === 1 && rest[0] === 'id') {
        const target = field.target === 'Entity' ? identityDefinition() : definitions.entity(field.target)
        return {
          branches: [{ steps: [...state.steps, { field: referenceStep(ownerField), kind: 'reference' }] }],
          field: {
            ...(target?.idFormat === undefined ? {} : { format: target.idFormat }),
            name: path,
            type: FieldType.ID,
          },
          identity: true,
          kind: 'field',
        }
      }
      if (state.occurrence >= MAX_GRAPH_PATH_DEPTH) return { kind: 'depth', path }
      const target = field.target === 'Entity' ? identityDefinition() : definitions.entity(field.target)
      if (target === undefined) return { entity: state.entity.name, kind: 'unknown', path }
      return expand({
        entity: target,
        occurrence: state.occurrence + 1,
        steps: [...state.steps, { field: referenceStep(ownerField), kind: 'reference' }],
      }, index + 1)
    }
    if (name === 'entity') {
      const root = identityDefinition().effectiveFields.find(candidate => candidate.name === 'entity')
      if (root === undefined) return { entity: state.entity.name, kind: 'unknown', path }
      if (rest.length !== 0) return { entity: state.entity.name, kind: 'non-reference', path, segment: name }
      return {
        branches: [{ steps: [...state.steps, { field: root, kind: 'field' }] }],
        field: { ...root, name: path } as QueryFieldDefinition,
        identity: false,
        kind: 'field',
      }
    }
    if (!state.entity.abstract) return { entity: state.entity.name, kind: 'unknown', path }
    const descendants = descendantFields(definitions, state.entity)
    const descendant = descendants.get(name)
    if (descendant !== undefined) {
      if (descendant.contracts.size > 1) {
        return { entity: state.entity.name, kind: 'incompatible', path, segment: name }
      }
      const branches: GraphPathBranch[] = []
      const collectionBranches: GraphPathBranch[] = []
      let expandedCollection = false
      let expandedField: { readonly field: QueryFieldDefinition, readonly identity: boolean } | undefined
      for (const variant of descendant.variants) {
        const guard = { leaves: variant.leaves, occurrence: state.occurrence } as const
        if (rest.length === 0) {
          if (variant.field.type === FieldType.Entity) {
            branches.push({
              steps: [...state.steps, {
                field: referenceStep(variant.field),
                guard,
                kind: 'reference',
              }],
            })
            const target = variant.field.target === 'Entity'
              ? identityDefinition()
              : definitions.entity(variant.field.target)
            expandedField ??= {
              field: {
                ...(target?.idFormat === undefined ? {} : { format: target.idFormat }),
                name: path,
                type: FieldType.ID,
              },
              identity: true,
            }
          } else {
            branches.push({
              steps: [...state.steps, { field: variant.field, guard, kind: 'field' }],
            })
            expandedField ??= { field: { ...variant.field, name: path }, identity: false }
          }
          continue
        }
        if (variant.field.type !== FieldType.Entity) {
          return { entity: state.entity.name, kind: 'non-reference', path, segment: name }
        }
        if (state.occurrence >= MAX_GRAPH_PATH_DEPTH) return { kind: 'depth', path }
        const target = variant.field.target === 'Entity'
          ? identityDefinition()
          : definitions.entity(variant.field.target)
        if (target === undefined) continue
        const expanded = expand({
          entity: target,
          occurrence: state.occurrence + 1,
          steps: [...state.steps, {
            field: referenceStep(variant.field),
            guard,
            kind: 'reference',
          }],
        }, index + 1)
        if (!('branches' in expanded)) {
          if (expanded.kind === 'incompatible' || expanded.kind === 'depth') return expanded
          continue
        }
        if (expanded.kind === 'collection') {
          expandedCollection = true
          collectionBranches.push(...expanded.branches)
        } else {
          branches.push(...expanded.branches)
          expandedField ??= { field: expanded.field, identity: expanded.identity }
        }
      }
      if (expandedCollection) {
        if (branches.length > 0) return { entity: state.entity.name, kind: 'unknown', path }
        return { branches: collectionBranches, kind: 'collection' }
      }
      if (branches.length === 0 || expandedField === undefined) {
        return { entity: state.entity.name, kind: 'unknown', path }
      }
      return {
        branches,
        field: { ...expandedField.field, name: path } as QueryFieldDefinition,
        identity: expandedField.identity,
        kind: 'field',
      }
    }
    const descendantCollections = state.entity.abstract
      ? collectCollections(definitions, state.entity).filter(candidate => candidate.collection.name === name)
      : []
    if (descendantCollections.length > 0 && rest.length === 0) {
      const contracts = new Set(descendantCollections.map(candidate => {
        const candidateCollection = candidate.collection
        return `${candidateCollection.target}:${candidateCollection.kind}`
      }))
      if (contracts.size > 1) return { entity: state.entity.name, kind: 'incompatible', path, segment: name }
      return {
        branches: descendantCollections.map(candidate => ({
          steps: [...state.steps, {
            collection: candidate.collection,
            guard: { leaves: candidate.leaves, occurrence: state.occurrence },
            kind: 'collection',
          }],
        })),
        kind: 'collection',
      }
    }
    return { entity: state.entity.name, kind: 'unknown', path }
  }
  return expand({ entity: start, occurrence: 0, steps: [] }, 0)
}

/**
 * Collect descendant collections by name with their concrete leaves.
 * @param definitions - Canonical definitions.
 * @param entity - Abstract entity being inspected.
 * @returns Collection declarations with their concrete leaves.
 */
function collectCollections(
  definitions: GraphPathDefinitions,
  entity: EntityDefinition,
): { readonly collection: DerivedCollectionDefinition, readonly leaves: readonly string[] }[] {
  const result: { collection: DerivedCollectionDefinition, leaves: string[] }[] = []
  for (const leaf of definitions.concreteDescendants(entity.name)) {
    for (const collection of leaf.collections) {
      const key = `${collection.kind}\u0000${JSON.stringify(collection)}`
      const existing = result.find(candidate => (
        `${candidate.collection.kind}\u0000${JSON.stringify(candidate.collection)}` === key
      ))
      if (existing === undefined) result.push({ collection, leaves: [leaf.name] })
      else existing.leaves.push(leaf.name)
    }
  }
  return result
}
