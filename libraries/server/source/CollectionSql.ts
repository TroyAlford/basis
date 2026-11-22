import type { ResolvedCollectionRelation } from './CollectionRelation'
import type { EntityDefinitions, QueryFieldDefinition } from './EntityDefinitions'
import { FieldType, relationshipView } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import type { QueryScope, SQLPredicate } from './SQL'
import { SQL } from './SQL'

/** Aliases used to compile one collection relation. */
export interface CollectionSqlAliases {
  /** Require authorized relations instead of the compatibility fallback. */
  readonly authorized?: true,
  /** Alias for the named-relationship table, when the collection is relationship-backed. */
  readonly relationship: string,
  /** Alias for the universal `Entity` root joined to the related row. */
  readonly root: string,
  /** Authorized relation for the universal root, when supplied by the planner. */
  readonly rootRelation?: string,
  /** Alias for the concrete related entity table, when it is not `Entity`. */
  readonly target: string,
  /** Authorized relation for a concrete target, when supplied by the planner. */
  readonly targetRelation?: string,
}

/** One compiled collection relation. */
export interface CollectionSqlRelation {
  /**
   * Correlated condition selecting source rows for the owning identity.
   *
   * Authored source predicates are returned separately so callers compose
   * their SQL and bound values into the surrounding statement.
   */
  readonly condition: string,
  /** Authored source predicate, when the collection declares one. */
  readonly predicate?: SQLPredicate,
  /** SQL relation containing source rows and any required root/target joins. */
  readonly relation: string,
  /** Relationship-table alias, when relationship-backed. */
  readonly relationshipAlias?: string,
  /** Result shape. */
  readonly resultType: 'entity' | 'record',
  /** Universal `Entity` root alias, when the result is an entity. */
  readonly rootAlias?: string,
  /** Concrete target alias, when the target is not `Entity`. */
  readonly targetAlias?: string,
}

/**
 * Compile the one canonical SQL relation for a resolved collection navigation.
 *
 * Query compilation and authorization use the same relation, identity,
 * correlation and authored-predicate semantics; only the parent identity
 * expression and aliases differ.
 * @param definitions - Validated entity definitions.
 * @param resolved - Canonical collection relation.
 * @param parentId - SQL expression for the owning row's universal identity.
 * @param aliases - Aliases reserved by the caller.
 * @returns The relation, its correlated condition and result identity.
 */
export function collectionSqlRelation(
  definitions: EntityDefinitions,
  resolved: ResolvedCollectionRelation,
  parentId: string,
  aliases: CollectionSqlAliases,
): CollectionSqlRelation {
  const predicate = sourcePredicate(definitions, resolved, aliases)
  const predicateEntry = predicate === undefined ? {} : { predicate }

  if (resolved.resultType === 'record') {
    if (resolved.source.kind !== 'relationship' || resolved.identity.kind !== 'record') {
      throw new Error('Record Collections require a relationship source and composite identity')
    }
    const relationship = resolved.source.relationship
    const relationshipAlias = aliases.relationship
    const ownerId = `${quote(relationshipAlias)}.${quote(resolved.owner.column)}`
    return {
      condition: `${ownerId} = ${parentId}`,
      relation: `${quote(relationship.name)} ${quote(relationshipAlias)}`,
      relationshipAlias,
      resultType: 'record',
      ...predicateEntry,
    }
  }

  if (resolved.target.kind !== 'entity') {
    throw new Error('Entity Collections require an entity target view')
  }
  const targetName = resolved.target.definition.name
  if (aliases.authorized === true) {
    if (targetName === 'Entity' && aliases.rootRelation === undefined) {
      throw new Error('Authorized Entity collections require a root relation')
    }
    if (targetName !== 'Entity' && aliases.targetRelation === undefined) {
      throw new Error(`Authorized collection target "${targetName}" requires a target relation`)
    }
  }
  const source = resolved.source
  if (source.kind === 'inverse') {
    if (targetName === 'Entity') {
      const ownerId = `${quote(aliases.root)}.${quote('id')}`
      return {
        condition: `${ownerId} = ${parentId}`,
        relation: `${quote(aliases.rootRelation ?? 'Entity')} ${quote(aliases.root)}`,
        resultType: 'entity',
        rootAlias: aliases.root,
        ...predicateEntry,
      }
    }
    const targetSource = `${quote(aliases.targetRelation ?? targetName)} ${quote(aliases.target)}`
    const ownerId = `${quote(aliases.target)}.${quote(resolved.owner.column)}`
    return {
      condition: `${ownerId} = ${parentId}`,
      relation: aliases.targetRelation === undefined
        ? `${targetSource} JOIN ${quote('Entity')} ${quote(aliases.root)} ` +
          `ON ${quote(aliases.root)}.${quote('id')} = ${quote(aliases.target)}.${quote('id')}`
        : targetSource,
      resultType: 'entity',
      rootAlias: aliases.targetRelation === undefined ? aliases.root : aliases.target,
      targetAlias: aliases.target,
      ...predicateEntry,
    }
  }

  const relationship = source.relationship
  const remote = source.remote
  if (!remote) {
    throw new Error(`Collection relationship "${relationship.name}" has no related endpoint`)
  }
  const remoteColumn = quote(`${remote.field}.id`)
  const ownerId = `${quote(aliases.relationship)}.${quote(resolved.owner.column)}`
  const condition = `${ownerId} = ${parentId}`
  const relationshipSource = `${quote(relationship.name)} ${quote(aliases.relationship)}`
  const rootId = `${quote(aliases.root)}.${quote('id')}`
  const remoteId = `${quote(aliases.relationship)}.${remoteColumn}`
  if (targetName === 'Entity') {
    return {
      condition,
      relation: `${relationshipSource} JOIN ${quote(aliases.rootRelation ?? 'Entity')} ` +
        `${quote(aliases.root)} ON ${rootId} = ${remoteId}`,
      relationshipAlias: aliases.relationship,
      resultType: 'entity',
      rootAlias: aliases.root,
      ...predicateEntry,
    }
  }
  const targetSource = `${quote(aliases.targetRelation ?? targetName)} ${quote(aliases.target)}`
  const targetId = `${quote(aliases.target)}.${quote('id')}`
  const targetJoin = `${relationshipSource} JOIN ${targetSource} ON ${targetId} = ${remoteId}`
  return {
    condition,
    relation: aliases.targetRelation === undefined
      ? `${targetJoin} JOIN ${quote('Entity')} ${quote(aliases.root)} ON ${rootId} = ${targetId}`
      : targetJoin,
    relationshipAlias: aliases.relationship,
    resultType: 'entity',
    rootAlias: aliases.targetRelation === undefined ? aliases.root : aliases.target,
    targetAlias: aliases.target,
    ...predicateEntry,
  }
}

/**
 * Lower the authored source predicates for one collection relation.
 * @param definitions - Validated entity definitions.
 * @param resolved - Canonical collection relation.
 * @param aliases - Aliases reserved by the caller.
 * @returns The predicate SQL and values, or undefined when the relation has none.
 */
function sourcePredicate(
  definitions: EntityDefinitions,
  resolved: ResolvedCollectionRelation,
  aliases: CollectionSqlAliases,
): SQLPredicate | undefined {
  const filters = resolved.predicates.filters
  if (filters.length === 0) return undefined
  if (resolved.source.kind !== 'relationship') {
    throw new Error('Only relationship-backed collections accept authored source predicates')
  }
  const relationship = resolved.source.relationship
  const view = relationshipView(relationship)
  const endpoints = new Map(relationship.between.map(endpoint => [endpoint.field, endpoint]))
  const fields = new Map<string, QueryFieldDefinition>(
    view.effectiveFields
      .filter(field => field.type !== FieldType.Entity)
      .map(field => [field.name, field as QueryFieldDefinition]),
  )
  const scope: QueryScope = {
    definition: view,
    expression: field => {
      const endpoint = endpoints.get(field.name)
      return `${quote(aliases.relationship)}.${quote(
        endpoint === undefined ? field.name : `${endpoint.field}.id`,
      )}`
    },
    field: name => sourceField(name, endpoints, fields),
  }
  const filter: Filter = filters.length === 1
    ? filters[0] as Filter
    : { filters, operator: Operator.Logical.And }
  const where = SQL.where(definitions, relationship.name, filter, scope)
  const result = { sql: where.predicate ?? '', values: where.values }
  Object.defineProperty(result, 'predicate', { enumerable: false, value: where.predicate })
  return result as typeof where
}

/**
 * Resolve one predicate field against a relationship source row.
 * @param name - Logical field name.
 * @param endpoints - Relationship endpoints keyed by field name.
 * @param fields - Relationship view fields keyed by name.
 * @returns The predicate field definition.
 * @throws {Error} When the field is not part of the relationship row.
 */
function sourceField(
  name: string,
  endpoints: ReadonlyMap<string, { readonly field: string }>,
  fields: ReadonlyMap<string, QueryFieldDefinition>,
): QueryFieldDefinition {
  if (endpoints.has(name)) return { name, type: FieldType.ID }
  const field = fields.get(name)
  if (!field) throw new Error(`Unknown collection source field "${name}"`)
  return field
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Identifier text.
 * @returns The quoted identifier.
 */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
