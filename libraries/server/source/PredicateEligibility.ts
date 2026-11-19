import type { EntityDefinition, EntityDefinitions } from './EntityDefinitions'
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
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeInternal(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: Filter,
): InternalAnalysis {
  if (isEligibilityPredicate(filter)) {
    return { applicable: null, guarded: filter, match: filter }
  }

  if (!('field' in filter) && 'filters' in filter) {
    return analyzeLogical(definitions, startEntity, filter)
  }
  if ('field' in filter && 'filters' in filter) {
    return analyzeCollection(definitions, startEntity, filter)
  }
  return analyzeComparison(definitions, startEntity, filter)
}

/**
 * Analyze one logical group.
 * @param definitions - Canonical entity definitions.
 * @param startEntity - Entity where the group is rooted.
 * @param filter - Logical filter.
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeLogical(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: LogicalFilter,
): InternalAnalysis {
  const children = filter.filters.map(child => analyzeInternal(definitions, startEntity, child))
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
      applicable: orFilters(children.map(child => child.applicable)),
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
  if (filter.operator === Operator.Collection.All) {
    throw new Error(`Query operator "${filter.operator}" must be normalized before eligibility analysis`)
  }
  const resolved = resolvePredicatePath(startEntity, filter.field, { definitions })
  if ('kind' in resolved) {
    throw new Error(`Predicate path "${filter.field}" cannot be resolved: ${resolved.kind}`)
  }
  const terminal = resolved.terminal
  if (!('kind' in terminal)) {
    throw new Error(`Predicate path "${filter.field}" is not a collection`)
  }
  const member = definitions.entity(terminal.target)
  const children = filter.filters.map(child => (
    member === undefined
      ? { applicable: null, guarded: child, match: child }
      : analyzeInternal(definitions, member, child)
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
 * @returns Applicability, match, and guarded lowering.
 */
function analyzeComparison(
  definitions: EntityDefinitions,
  startEntity: EntityDefinition,
  filter: ComparisonFilter,
): InternalAnalysis {
  const left = eligibilityFilters(resolveEligibility(definitions, startEntity, filter.field))
  const right = isFieldOperand(filter.value) && filter.value.$field !== '$me'
    ? eligibilityFilters(resolveEligibility(definitions, startEntity, filter.value.$field))
    : null
  const applicable = andFilters([left, right])
  return {
    applicable,
    guarded: guard(applicable, filter),
    match: filter,
  }
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
  const applicableKeys = new Set(eligibilityKeys(applicable))
  if (applicableKeys.size === 0) return notFilter(guarded)
  const remaining = guarded.filters.filter(filter => (
    !isEligibilityPredicate(filter) || !applicableKeys.has(eligibilityKey(filter))
  ))
  if (remaining.length === guarded.filters.length) return notFilter(guarded)
  if (remaining.length === 0) return notFilter(guarded)
  const body = remaining.length === 1
    ? remaining[0] as Filter
    : { filters: remaining, operator: Operator.Logical.And }
  return notFilter(body)
}

/**
 * Return the generated guard keys in one applicability filter.
 * @param filter - Applicability guard.
 * @returns Guard keys.
 */
function eligibilityKeys(filter: Filter): string[] {
  const filters = isLogicalAnd(filter) ? filter.filters : [filter]
  return filters.filter(isEligibilityPredicate).map(eligibilityKey)
}

/**
 * Return one generated guard's stable identity.
 * @param filter - Eligibility comparison.
 * @returns Stable key.
 */
function eligibilityKey(filter: ComparisonFilter): string {
  return `${filter.field}\u0000${JSON.stringify(filter.value)}`
}

/**
 * Whether a filter is a generated entity-membership guard.
 * @param filter - Candidate filter.
 * @returns `true` for a terminal eligibility predicate.
 */
function isEligibilityPredicate(filter: Filter): filter is ComparisonFilter {
  return !('filters' in filter)
    && filter.operator === Operator.Comparison.In
    && (filter.field === 'entity' || filter.field.endsWith('.entity'))
    && Array.isArray(filter.value)
    && filter.value.every(value => typeof value === 'string')
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
