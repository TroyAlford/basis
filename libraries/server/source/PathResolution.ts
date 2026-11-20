import type { DerivedCollectionDefinition, EffectiveFieldDefinition } from './EntityDefinitions'
import type { EntityDefinition, EntityReferenceFieldDefinition } from './EntityDefinitions'
import type { EntityDefinitions, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType, identityDefinition } from './EntityDefinitions'
import { logicalFieldContract } from './EntityDefinitions'
import { parseCollectionDirectives, splitFieldPath } from './PathSyntax'

/** Maximum singular-reference hops in one Graph path. */
export const MAX_GRAPH_PATH_DEPTH = 8

/** One canonical path-resolution failure. */
export type PathFailure =
  | { readonly entity: string, readonly kind: 'unknown', readonly path: string }
  | { readonly entity: string, readonly kind: 'non-reference', readonly path: string, readonly segment: string }
  | {
    readonly contracts: readonly string[],
    readonly entity: string,
    readonly kind: 'ambiguous',
    readonly path: string,
  }
  | { readonly entity: string, readonly kind: 'invalid-count', readonly path: string, readonly segment: string }
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

/** Concrete entity types eligible at one reference occurrence. */
export interface ConcreteEligibility {
  /** Concrete entity names that possess or inherit the resolved field. */
  readonly entityTypes: readonly string[],
  /** Zero is the query root; each reference hop adds one occurrence. */
  readonly occurrence: number,
  /** Logical path to the occurrence's entity discriminator. */
  readonly path: string,
}

/** One physical sequence used to bind a resolved predicate path. */
export interface PhysicalPathVariant {
  /** Effective fields, references, and terminal collection in traversal order. */
  readonly fields: readonly (DerivedCollectionDefinition | EffectiveFieldDefinition)[],
  /** Concrete-type restrictions that select this sequence. */
  readonly restrictions: readonly ConcreteEligibility[],
}

/** One canonical predicate path with applicability and physical variants. */
export interface ResolvedPredicatePath {
  /** Concrete eligibility restrictions, one per applicable occurrence. */
  readonly eligibility: readonly ConcreteEligibility[],
  /** Original logical path. */
  readonly path: string,
  /** Terminal value field or collection. */
  readonly terminal: DerivedCollectionDefinition | QueryFieldDefinition,
  /** Physical sequences retained for SQL binding. */
  readonly variants: readonly PhysicalPathVariant[],
}

/** Entity metadata used to resolve polymorphic predicate paths. */
export interface PredicatePathOptions {
  /** Canonical entity definitions, including concrete descendants. */
  readonly definitions: EntityDefinitions,
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

/** One in-progress predicate-path traversal. */
interface PredicateTraversalState {
  /** Current occurrence entity. */
  readonly current: EntityDefinition,
  /** Physical sequence accumulated so far. */
  readonly fields: readonly (DerivedCollectionDefinition | EffectiveFieldDefinition)[],
  /** Logical path to the current occurrence. */
  readonly logicalPath: string,
  /** Current occurrence index. */
  readonly occurrence: number,
  /** Singular reference hops traversed so far. */
  readonly referenceHops: number,
  /** Concrete eligibility accumulated so far. */
  readonly restrictions: readonly ConcreteEligibility[],
  /** Terminal field or collection, set only on completion. */
  readonly terminal?: DerivedCollectionDefinition | QueryFieldDefinition,
}

/** Successful result of resolving one path segment. */
interface PredicateSegmentResolution {
  /** Traversal states that survive this segment. */
  readonly states: readonly PredicateTraversalState[],
}

/**
 * Resolve one predicate path with concrete eligibility and physical variants.
 * @param entity - Entity where the path starts.
 * @param path - Logical field, reference, or collection path.
 * @param options - Canonical entity definitions.
 * @returns The resolved path metadata, or a failure.
 */
export function resolvePredicatePath(
  entity: EntityDefinition,
  path: string,
  options: PredicatePathOptions,
): ResolvedPredicatePath | PathFailure {
  let segments: readonly string[]
  try {
    segments = splitFieldPath(path)
  } catch {
    return { entity: entity.name, kind: 'unknown', path }
  }
  if (segments.length === 0 || segments.some(segment => segment.length === 0)) {
    return { entity: entity.name, kind: 'unknown', path }
  }
  const suffix = segments[segments.length - 1]
  if (suffix === '$total' || suffix === '$matched') {
    return resolveCountPath(entity, path, segments, suffix, options)
  }

  let states: PredicateTraversalState[] = [{
    current: entity,
    fields: [],
    logicalPath: '',
    occurrence: 0,
    referenceHops: 0,
    restrictions: [],
  }]

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1
    const next: PredicateTraversalState[] = []
    let failure: PathFailure | undefined
    for (const state of states) {
      const resolved = resolvePredicateSegment(state, segment, isLast, path, options)
      if ('kind' in resolved) {
        failure = failure ?? resolved
      } else {
        next.push(...resolved.states)
      }
    }
    if (next.length === 0) {
      return failure ?? { entity: entity.name, kind: 'unknown', path }
    }
    states = next
  }

  const terminal = states[0]?.terminal
  if (terminal === undefined) return { entity: entity.name, kind: 'unknown', path }
  return {
    eligibility: mergeEligibility(states.flatMap(state => state.restrictions)),
    path,
    terminal,
    variants: buildPhysicalVariants(states),
  }
}

/**
 * Resolve one supported collection or native-array count suffix.
 * @param entity - Entity where the path starts.
 * @param path - Original full path.
 * @param segments - Parsed path segments.
 * @param suffix - Count suffix.
 * @param options - Canonical entity definitions.
 * @returns The numeric count path or a failure.
 */
function resolveCountPath(
  entity: EntityDefinition,
  path: string,
  segments: readonly string[],
  suffix: '$matched' | '$total',
  options: PredicatePathOptions,
): PathFailure | ResolvedPredicatePath {
  if (segments.length < 2) {
    return { entity: entity.name, kind: 'invalid-count', path, segment: suffix }
  }
  const owners = [...segments.slice(0, -1)]
  const lastOwner = owners[owners.length - 1] as string
  let ownerName: string
  try {
    ownerName = parseCollectionDirectives(lastOwner).name
  } catch {
    return { entity: entity.name, kind: 'unknown', path }
  }
  owners[owners.length - 1] = ownerName
  const base = resolvePredicatePath(entity, owners.join('.'), options)
  if ('kind' in base) return base
  const terminal = base.terminal
  const collection = 'kind' in terminal
  if (!collection && terminal.type !== FieldType.Array) {
    return { entity: entity.name, kind: 'invalid-count', path, segment: suffix }
  }
  if (suffix === '$matched' && !collection) {
    return { entity: entity.name, kind: 'invalid-count', path, segment: suffix }
  }
  return {
    eligibility: base.eligibility,
    path,
    terminal: { name: path, type: FieldType.Number },
    variants: base.variants,
  }
}

/**
 * Resolve one segment across every surviving traversal state.
 * @param state - Current traversal state.
 * @param segment - Current segment.
 * @param isLast - Whether this is the terminal segment.
 * @param path - Original full path.
 * @param options - Canonical entity definitions.
 * @returns Survivor states or a failure.
 */
function resolvePredicateSegment(
  state: PredicateTraversalState,
  segment: string,
  isLast: boolean,
  path: string,
  options: PredicatePathOptions,
): PathFailure | PredicateSegmentResolution {
  const field = state.current.effectiveFields.find(candidate => candidate.name === segment)
  const collection = state.current.collections.find(candidate => candidate.name === segment)
  if (field && collection) {
    return {
      contracts: [logicalFieldContract(field), logicalFieldContract(collection)],
      entity: state.current.name,
      kind: 'ambiguous',
      path,
    }
  }
  if (collection) return resolveDeclaredCollection(state, collection, segment, isLast, path)
  if (field) return resolveDeclaredField(state, field, segment, isLast, path, options)
  return resolveDescendantSegment(state, segment, isLast, path, options)
}

/**
 * Resolve one field declared or inherited at the current occurrence.
 * @param state - Current traversal state.
 * @param field - Effective field.
 * @param segment - Current segment.
 * @param isLast - Whether this is the terminal segment.
 * @param path - Original full path.
 * @param options - Canonical entity definitions.
 * @returns Survivor states or a failure.
 */
function resolveDeclaredField(
  state: PredicateTraversalState,
  field: EffectiveFieldDefinition,
  segment: string,
  isLast: boolean,
  path: string,
  options: PredicatePathOptions,
): PathFailure | PredicateSegmentResolution {
  if (field.type === FieldType.Entity) {
    if (isLast) {
      return {
        states: [{
          ...state,
          fields: [...state.fields, field],
          terminal: { name: path, type: FieldType.ID },
        }],
      }
    }
    if (state.referenceHops >= MAX_GRAPH_PATH_DEPTH) return { kind: 'depth', path }
    const target = field.target === 'Entity' ? identityDefinition() : options.definitions.entity(field.target)
    if (!target) return { entity: state.current.name, kind: 'unknown', path }
    return {
      states: [{
        ...state,
        current: target,
        fields: [...state.fields, field],
        logicalPath: joinPath(state.logicalPath, segment),
        occurrence: state.occurrence + 1,
        referenceHops: state.referenceHops + 1,
      }],
    }
  }
  if (!isLast) {
    return { entity: state.current.name, kind: 'non-reference', path, segment }
  }
  return {
    states: [{
      ...state,
      fields: [...state.fields, field],
      terminal: { ...field, name: path },
    }],
  }
}

/**
 * Resolve one collection declared or inherited at the current occurrence.
 * @param state - Current traversal state.
 * @param collection - Derived collection.
 * @param segment - Current segment.
 * @param isLast - Whether this is the terminal segment.
 * @param path - Original full path.
 * @returns Survivor states or a failure.
 */
function resolveDeclaredCollection(
  state: PredicateTraversalState,
  collection: DerivedCollectionDefinition,
  segment: string,
  isLast: boolean,
  path: string,
): PathFailure | PredicateSegmentResolution {
  if (!isLast) {
    return { entity: state.current.name, kind: 'non-reference', path, segment }
  }
  return {
    states: [{
      ...state,
      fields: [...state.fields, collection],
      terminal: collection,
    }],
  }
}

/**
 * Resolve one descendant-only segment across concrete descendants.
 * @param state - Current traversal state.
 * @param segment - Current segment.
 * @param isLast - Whether this is the terminal segment.
 * @param path - Original full path.
 * @param options - Canonical entity definitions.
 * @returns Survivor states or a failure.
 */
function resolveDescendantSegment(
  state: PredicateTraversalState,
  segment: string,
  isLast: boolean,
  path: string,
  options: PredicatePathOptions,
): PathFailure | PredicateSegmentResolution {
  const candidates: {
    readonly source: DerivedCollectionDefinition | EffectiveFieldDefinition,
    readonly type: EntityDefinition,
  }[] = []
  for (const type of options.definitions.concreteDescendants(state.current.name)) {
    const collection = type.collections.find(candidate => candidate.name === segment)
    if (collection) {
      candidates.push({ source: collection, type })
      continue
    }
    const field = type.effectiveFields.find(candidate => candidate.name === segment)
    if (field) candidates.push({ source: field, type })
  }
  if (candidates.length === 0) {
    return { entity: state.current.name, kind: 'unknown', path }
  }
  if (state.current.name === 'Entity') {
    const contracts = [...new Set(candidates.map(candidate => logicalFieldContract(candidate.source)))]
    if (contracts.length > 1) {
      return { contracts, entity: 'Entity', kind: 'ambiguous', path }
    }
  }

  const states: PredicateTraversalState[] = []
  let sawNonReference = false
  for (const candidate of candidates) {
    const restrictions = [...state.restrictions, {
      entityTypes: [candidate.type.name],
      occurrence: state.occurrence,
      path: occurrencePath(state),
    }]
    if ('kind' in candidate.source) {
      if (isLast) {
        states.push({
          ...state,
          fields: [...state.fields, candidate.source],
          restrictions,
          terminal: candidate.source,
        })
      } else {
        sawNonReference = true
      }
      continue
    }
    const field = candidate.source
    if (field.type === FieldType.Entity) {
      if (isLast) {
        states.push({
          ...state,
          fields: [...state.fields, field],
          restrictions,
          terminal: { name: path, type: FieldType.ID },
        })
        continue
      }
      if (state.referenceHops >= MAX_GRAPH_PATH_DEPTH) return { kind: 'depth', path }
      const target = field.target === 'Entity' ? identityDefinition() : options.definitions.entity(field.target)
      if (!target) return { entity: candidate.type.name, kind: 'unknown', path }
      states.push({
        ...state,
        current: target,
        fields: [...state.fields, field],
        logicalPath: joinPath(state.logicalPath, segment),
        occurrence: state.occurrence + 1,
        referenceHops: state.referenceHops + 1,
        restrictions,
      })
      continue
    }
    if (!isLast) {
      sawNonReference = true
      continue
    }
    states.push({
      ...state,
      fields: [...state.fields, field],
      restrictions,
      terminal: { ...field, name: path },
    })
  }
  if (states.length === 0) {
    return sawNonReference
      ? { entity: state.current.name, kind: 'non-reference', path, segment }
      : { entity: state.current.name, kind: 'unknown', path }
  }
  return { states }
}

/**
 * Merge eligibility entries by occurrence and path.
 * @param entries - Eligibility entries to merge.
 * @returns Deterministic deduplicated eligibility.
 */
function mergeEligibility(entries: readonly ConcreteEligibility[]): ConcreteEligibility[] {
  const merged = new Map<string, { entityTypes: string[], occurrence: number, path: string }>()
  for (const entry of entries) {
    const key = `${entry.occurrence}\u0000${entry.path}`
    const existing = merged.get(key) ?? {
      entityTypes: [],
      occurrence: entry.occurrence,
      path: entry.path,
    }
    for (const type of entry.entityTypes) {
      if (!existing.entityTypes.includes(type)) existing.entityTypes.push(type)
    }
    merged.set(key, existing)
  }
  return [...merged.values()]
    .map(entry => ({
      entityTypes: entry.entityTypes,
      occurrence: entry.occurrence,
      path: entry.path,
    }))
    .sort((left, right) => left.occurrence - right.occurrence || left.path.localeCompare(right.path))
}

/**
 * Group terminal traversal states by physical sequence.
 * @param states - Completed traversal states.
 * @returns Physical variants with merged restrictions.
 */
function buildPhysicalVariants(states: readonly PredicateTraversalState[]): PhysicalPathVariant[] {
  const variants = new Map<string, {
    readonly fields: readonly (DerivedCollectionDefinition | EffectiveFieldDefinition)[],
    readonly restrictions: ConcreteEligibility[],
  }>()
  for (const state of states) {
    const key = state.fields.map(physicalDefinitionKey).join('\u0000>\u0000')
    const variant = variants.get(key) ?? { fields: state.fields, restrictions: [] }
    variant.restrictions.push(...state.restrictions)
    variants.set(key, variant)
  }
  return [...variants.values()].map(variant => ({
    fields: variant.fields,
    restrictions: mergeEligibility(variant.restrictions),
  }))
}

/**
 * Return the discriminator path for one traversal occurrence.
 * @param state - Traversal state.
 * @returns `entity` for the root, otherwise `<referencePath>.entity`.
 */
function occurrencePath(state: PredicateTraversalState): string {
  return state.occurrence === 0 ? 'entity' : `${state.logicalPath}.entity`
}

/**
 * Join one logical path segment.
 * @param prefix - Existing path prefix.
 * @param segment - New segment.
 * @returns The joined path.
 */
function joinPath(prefix: string, segment: string): string {
  return prefix === '' ? segment : `${prefix}.${segment}`
}

/**
 * Build a stable physical identity for one traversal definition.
 * @param source - Effective field or derived collection.
 * @returns A stable key for grouping variants.
 */
function physicalDefinitionKey(source: DerivedCollectionDefinition | EffectiveFieldDefinition): string {
  if ('kind' in source) {
    if (source.kind === 'explicit') {
      return `explicit:${source.owner}:${source.name}:${source.relationship.name}:` +
        `${source.target}:${source.targetEndpoint?.field ?? ''}:${source.via}`
    }
    if (source.kind === 'relationship') {
      return `relationship:${source.relationship.name}:${source.endpoint}:${source.name}:${source.target}`
    }
    return `inverse:${source.association.forwardOwner}:${source.association.forward.name}:` +
      `${source.name}:${source.target}`
  }
  const target = 'target' in source ? source.target : ''
  const column = 'column' in source ? source.column : ''
  const items = 'items' in source ? `${source.items.type}:${source.items.format ?? ''}` : ''
  const format = 'format' in source ? source.format ?? '' : ''
  return `field:${source.owner}:${source.name}:${source.type}:${target}:${column}:${items}:${format}`
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
