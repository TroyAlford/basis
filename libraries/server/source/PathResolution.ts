import type { DerivedCollectionDefinition, EffectiveFieldDefinition, EntityDefinition, EntityReferenceFieldDefinition, FieldDefinition, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'

/** Maximum singular-reference hops in one Graph path. */
export const MAX_GRAPH_PATH_DEPTH = 8

/** One canonical path-resolution failure. */
export type PathFailure =
  | { readonly entity: string, readonly kind: 'unknown', readonly path: string }
  | { readonly entity: string, readonly kind: 'non-reference', readonly path: string, readonly segment: string }
  | { readonly kind: 'depth', readonly path: string }

/** Entity lookup used while resolving a path. */
export interface PathResolutionOptions {
  /** Resolve one entity by name. */
  readonly resolve: (name: string) => EntityDefinition | undefined,
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
  const segments = path.split('.')
  if (segments.some(segment => segment.length === 0)) {
    return { entity: entity.name, kind: 'unknown', path }
  }
  const hops: FieldPathHop[] = []
  let current = entity
  let logical = ''
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string
    logical = logical === '' ? segment : `${logical}.${segment}`
    const field = current.effectiveFields.find(candidate => candidate.name === segment)
    if (!field) return { entity: current.name, kind: 'unknown', path }
    if (field.type !== FieldType.Entity) {
      return { entity: current.name, kind: 'non-reference', path, segment }
    }
    if (index === segments.length - 2 && segments[segments.length - 1] === 'id') {
      return {
        field: { name: path, type: FieldType.ID },
        hops,
        identity: true,
        segments,
        terminal: field,
      }
    }
    if (hops.length >= MAX_GRAPH_PATH_DEPTH) return { kind: 'depth', path }
    hops.push({ field, path: logical })
    const target = field.target === 'Entity' ? identityDefinition() : options.resolve(field.target)
    if (!target) return { entity: current.name, kind: 'unknown', path }
    current = target
  }
  const terminalName = segments[segments.length - 1] as string
  const terminal = current.effectiveFields.find(candidate => candidate.name === terminalName)
  if (!terminal) return { entity: current.name, kind: 'unknown', path }
  if (terminal.type === FieldType.Entity) {
    return {
      field: { name: path, type: FieldType.ID },
      hops,
      identity: true,
      segments,
      terminal,
    }
  }
  return {
    field: { ...terminal, name: path },
    hops,
    identity: false,
    segments,
    terminal,
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
  const direct = entity.collections.find(collection => collection.name === path)
  if (direct) return { collection: direct, owner: entity, prefix: '' }
  const segments = path.split('.')
  if (segments.some(segment => segment.length === 0)) {
    return { entity: entity.name, kind: 'unknown', path }
  }
  const prefix = segments.slice(0, -1).join('.')
  const resolved = resolveFieldPath(entity, prefix, options)
  if ('kind' in resolved) return resolved
  if (resolved.terminal.type !== FieldType.Entity) return undefined
  const owner = resolved.terminal.target === 'Entity'
    ? identityDefinition()
    : options.resolve(resolved.terminal.target)
  if (!owner) return { entity: entity.name, kind: 'unknown', path }
  const collection = owner.collections.find(candidate => candidate.name === segments[segments.length - 1])
  return collection ? { collection, owner, prefix } : undefined
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
