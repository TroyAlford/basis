import type { EntityDefinition, EntityDefinitions } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { ConcreteEligibility } from './PathResolution'
import { resolvePredicatePath } from './PathResolution'
import type { CollectionFilter, ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { isFieldOperand, Predicate } from './Predicate'

/** One analyzed predicate with its applicability guard and matching expression. */
export interface AnalyzedPredicate {
  /** Filter that must hold for the predicate to be applicable, or null for TRUE. */
  readonly applicable: Filter | null,
  /** Original or composed matching predicate. */
  readonly match: Filter,
}

/** Internal analysis carrying the fully guarded lowering. */
interface InternalAnalysis extends AnalyzedPredicate {
  /** Fully guarded matching expression. */
  readonly guarded: Filter,
}

/** Relationship-owned member paths available inside one collection scope. */
interface MemberScope {
  /** Prefix for relationship-owned properties, when present. */
  readonly relationshipPrefix?: string,
}

/**
 * Canonical predicate eligibility analysis.
 *
 * Converts descendant-only field applicability into ordinary `entity $in [...]`
 * guards and composes them through the existing logical operator vocabulary.
 */
export const PredicateEligibility = {
  /**
   * Analyze one normalized filter.
   * @param definitions - Canonical entity definitions.
   * @param startEntity - Entity where the predicate is rooted.
   * @param filter - Normalized filter tree.
   * @returns Applicability and matching predicate.
   * @throws {Error} When a normalized path cannot be resolved.
   */
  analyze(
    definitions: EntityDefinitions,
    startEntity: EntityDefinition,
    filter: Filter,
  ): AnalyzedPredicate {
    const analysis = analyzeInternal(definitions, startEntity, filter)
    return { applicable: analysis.applicable, match: analysis.match }
  },

  /**
   * Lower one normalized filter into its guarded matching expression.
   * @param definitions - Canonical entity definitions.
   * @param startEntity - Entity where the predicate is rooted.
   * @param filter - Normalized filter tree.
   * @returns The fully guarded filter tree.
   * @throws {Error} When a normalized path cannot be resolved.
   */
  lower(
    definitions: EntityDefinitions,
    startEntity: EntityDefinition,
    filter: Filter,
  ): Filter {
    return analyzeInternal(definitions, startEntity, filter).guarded
  },
}

/**
 * Analyze one filter recursively.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the filter is rooted.
 * @param filter - Normalized filter tree.
 * @param memberScope - Active relationship-owned member scope.
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeInternal(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: Filter,
  memberScope?: MemberScope,
): InternalAnalysis {
  if (!('field' in filter) && 'filters' in filter) {
    return analyzeLogical(definitions, startEntity, filter, memberScope)
  }
  if ('field' in filter && 'filters' in filter) {
    return analyzeCollection(definitions, startEntity, filter)
  }
  return analyzeComparison(definitions, startEntity, filter, memberScope)
}

/**
 * Analyze one logical group.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the group is rooted.
 * @param filter - Logical filter.
 * @param memberScope - Active relationship-owned member scope.
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeLogical(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: LogicalFilter,
  memberScope?: MemberScope,
): InternalAnalysis {
  const children = filter.filters.map(child => (
    analyzeInternal(definitions, startEntity, child, memberScope)
  ))
  if (filter.operator === Operator.Logical.Not) {
    const child = children[0]
    if (!child) throw new Error('Query logical NOT requires exactly one filter')
    const match = notFilter(child.match)
    return {
      applicable: child.applicable,
      guarded: guard(child.applicable, negateGuarded(child.applicable, child.guarded)),
      match,
    }
  }

  if (filter.operator === Operator.Logical.Or) {
    return {
      applicable: orApplicability(children.map(child => child.applicable)),
      guarded: orFilters(children.map(child => child.guarded)) ?? filter,
      match: orFilters(children.map(child => child.match)) ?? filter,
    }
  }
  return {
    applicable: andFilters(children.map(child => child.applicable)),
    guarded: andFilters(children.map(child => child.guarded)) ?? filter,
    match: andFilters(children.map(child => child.match)) ?? filter,
  }
}

/**
 * Analyze one collection filter and its member requirements.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the collection is rooted.
 * @param filter - Collection filter.
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeCollection(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: CollectionFilter,
): InternalAnalysis {
  const resolved = resolvePredicatePath(startEntity, filter.field, { definitions })
  if ('kind' in resolved) {
    throw new Error(`Predicate path "${filter.field}" cannot be resolved: ${resolved.kind}`)
  }
  const terminal = resolved.terminal
  if (!('kind' in terminal)) {
    if (terminal.type !== FieldType.Array) {
      throw new Error(`Predicate path "${filter.field}" is not a collection or native array`)
    }
    const applicable = eligibilityFilters(resolved.eligibility)
    return {
      applicable,
      guarded: guard(applicable, filter),
      match: filter,
    }
  }
  const member = definitions.entity(terminal.target)
  let memberScope: MemberScope | undefined
  if (member !== undefined) {
    memberScope = 'relationship' in terminal
      ? { relationshipPrefix: `${lowerFirst(terminal.relationship.name)}.` }
      : {}
  }
  const children = filter.filters.map(child => (
    member === undefined
      ? { applicable: null, guarded: child, match: child }
      : analyzeInternal(definitions, member, child, memberScope)
  ))
  const applicable = eligibilityFilters(resolved.eligibility)
  const match: CollectionFilter = {
    ...filter,
    filters: children.map(child => child.match),
  }
  return {
    applicable,
    guarded: guard(applicable, {
      ...filter,
      filters: children.map(child => child.guarded),
    }),
    match,
  }
}

/**
 * Analyze one atomic comparison.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the comparison is rooted.
 * @param filter - Comparison filter.
 * @param memberScope - Active relationship-owned member scope.
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeComparison(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: ComparisonFilter,
  memberScope?: MemberScope,
): InternalAnalysis {
  const left = isRelationshipPath(filter.field, memberScope)
    ? null
    : eligibilityFilters(resolveEligibility(definitions, startEntity, filter.field))
  const rightPath = isFieldOperand(filter.value) && filter.value.$field !== '$me'
    ? filter.value.$field
    : undefined
  const right = rightPath === undefined || isRelationshipPath(rightPath, memberScope)
    ? null
    : eligibilityFilters(resolveEligibility(definitions, startEntity, rightPath))
  const applicable = andFilters([left, right])
  return {
    applicable,
    guarded: guard(applicable, filter),
    match: filter,
  }
}

/**
 * Whether a path is owned by the active collection relationship.
 * @param path - Member field path.
 * @param scope - Active member scope.
 * @returns `true` for relationship-owned properties.
 */
function isRelationshipPath(path: string, scope?: MemberScope): boolean {
  return scope?.relationshipPrefix !== undefined && path.startsWith(scope.relationshipPrefix)
}

/**
 * Lower the first character of a name.
 * @param value - Name to lower.
 * @returns Lower-cased name.
 */
function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`
}

/**
 * Resolve one path's concrete eligibility.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the path is rooted.
 * @param path - Logical field path.
 * @returns Concrete eligibility entries.
 * @throws {Error} When the normalized path cannot be resolved.
 */
function resolveEligibility(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  path: string,
): readonly ConcreteEligibility[] {
  if (path === '$me') return []
  const resolved = resolvePredicatePath(startEntity, path, { definitions })
  if ('kind' in resolved) {
    throw new Error(`Predicate path "${path}" cannot be resolved: ${resolved.kind}`)
  }
  return resolved.eligibility
}

/**
 * Convert concrete eligibility into ordinary entity membership guards.
 * @param entries - Concrete eligibility entries.
 * @returns Guard filter, or null for universal applicability.
 */
function eligibilityFilters(entries: readonly ConcreteEligibility[]): Filter | null {
  return andFilters(entries.map(eligibilityFilter))
}

/**
 * Convert one concrete eligibility entry into an entity membership guard.
 * @param entry - Concrete eligibility entry.
 * @returns The guard filter, or null when the entry is empty.
 */
function eligibilityFilter(entry: ConcreteEligibility): Filter | null {
  if (entry.entityTypes.length === 0) return null
  return {
    field: entry.path,
    operator: Operator.Comparison.In,
    value: [...entry.entityTypes],
  }
}

/**
 * Combine applicability and matching filters.
 * @param applicable - Applicability guard, or null for TRUE.
 * @param match - Matching predicate.
 * @returns The guarded predicate.
 */
function guard(applicable: Filter | null, match: Filter): Filter {
  return applicable === null ? match : andFilters([applicable, match]) ?? match
}

/**
 * Build a conjunctive filter, flattening nested AND groups.
 * @param filters - Child filters, including nulls for TRUE.
 * @returns The canonical conjunction, or null when empty.
 */
function andFilters(filters: readonly (Filter | null)[]): Filter | null {
  const flat: Filter[] = []
  for (const filter of filters) {
    if (filter === null) continue
    if (isLogicalAnd(filter)) flat.push(...filter.filters)
    else flat.push(filter)
  }
  const deduped = dedupeFilters(flat)
  if (deduped.length === 0) return null
  if (deduped.length === 1) return deduped[0] as Filter
  return { filters: deduped, operator: Operator.Logical.And }
}

/**
 * Compose applicability through OR, where TRUE absorbs the disjunction.
 * @param filters - Child applicability guards, with null meaning TRUE.
 * @returns TRUE when any operand is universally applicable, otherwise the guard disjunction.
 */
function orApplicability(filters: readonly (Filter | null)[]): Filter | null {
  return filters.some(filter => filter === null) ? null : orFilters(filters)
}

/**
 * Build a disjunctive filter, flattening nested OR groups.
 * @param filters - Child filters, including nulls for TRUE.
 * @returns The canonical disjunction, or null when every operand is TRUE.
 */
function orFilters(filters: readonly (Filter | null)[]): Filter | null {
  const flat: Filter[] = []
  for (const filter of filters) {
    if (filter === null) continue
    if (isLogicalOr(filter)) flat.push(...filter.filters)
    else flat.push(filter)
  }
  const deduped = dedupeFilters(flat)
  if (deduped.length === 0) return null
  if (deduped.length === 1) return deduped[0] as Filter
  return { filters: deduped, operator: Operator.Logical.Or }
}

/**
 * Deduplicate identical filters inside one logical group.
 * @param filters - Flattened group children.
 * @returns Filters with duplicates removed.
 */
function dedupeFilters(filters: readonly Filter[]): Filter[] {
  const seen = new Set<string>()
  return filters.filter(filter => {
    const key = filterKey(filter)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Build a stable structural key for one filter value.
 * @param value - Filter or nested filter value.
 * @returns Stable key.
 */
function filterKey(value: unknown): string {
  if (value instanceof Date) {
    return `Date:${Number.isNaN(value.getTime()) ? 'Invalid' : value.toISOString()}`
  }
  if (Array.isArray(value)) return `[${value.map(filterKey).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${filterKey(record[key])}`
    )).join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Negate a child's guarded matching expression.
 *
 * The outer NOT still carries the child's applicability guard. When the child's
 * guarded expression is an AND whose leading guards match that applicability,
 * negating the remaining match is equivalent and avoids `NOT(guard AND match)`.
 * @param applicable - Child applicability guard.
 * @param guarded - Child guarded matching expression.
 * @returns The negated match without duplicate guard application.
 */
function negateGuarded(applicable: Filter | null, guarded: Filter): Filter {
  if (applicable === null || !isLogicalAnd(guarded)) return notFilter(guarded)
  const applicableFilters = isLogicalAnd(applicable) ? applicable.filters : [applicable]
  const applicableKeys = new Set(applicableFilters.map(filterKey))
  const remaining = guarded.filters.filter(filter => !applicableKeys.has(filterKey(filter)))
  if (remaining.length === guarded.filters.length) return notFilter(guarded)
  if (remaining.length === 0) return notFilter(guarded)
  const body = remaining.length === 1
    ? remaining[0] as Filter
    : { filters: remaining, operator: Operator.Logical.And }
  return notFilter(body)
}

/**
 * Whether a filter is a logical AND group.
 * @param filter - Candidate filter.
 * @returns `true` for an AND group.
 */
function isLogicalAnd(filter: Filter): filter is LogicalFilter {
  return !('field' in filter) && filter.operator === Operator.Logical.And
}

/**
 * Whether a filter is a logical OR group.
 * @param filter - Candidate filter.
 * @returns `true` for an OR group.
 */
function isLogicalOr(filter: Filter): filter is LogicalFilter {
  return !('field' in filter) && filter.operator === Operator.Logical.Or
}

/**
 * Build one unary negation group.
 * @param filter - Filter to negate.
 * @returns The canonical NOT group.
 */
function notFilter(filter: Filter): LogicalFilter {
  return Predicate.not(filter)
}
