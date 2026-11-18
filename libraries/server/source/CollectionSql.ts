import type { ResolvedCollectionRelation } from './CollectionRelation'

/** Aliases used to compile one collection relation. */
export interface CollectionSqlAliases {
  /** Alias for the named-relationship table, when the collection is relationship-backed. */
  readonly relationship: string,
  /** Alias for the universal `Entity` root joined to the related row. */
  readonly root: string,
  /** Alias for the concrete related entity table, when it is not `Entity`. */
  readonly target: string,
}

/** One compiled collection relation. */
export interface CollectionSqlRelation {
  /** Correlated condition joining the related row to its parent identity. */
  readonly condition: string,
  /** SQL relation containing the related rows and any required root/target joins. */
  readonly relation: string,
  /** Relationship-table alias, when relationship-backed. */
  readonly relationshipAlias?: string,
  /** Universal `Entity` root alias. */
  readonly rootAlias: string,
  /** Concrete target alias, when the target is not `Entity`. */
  readonly targetAlias?: string,
}

/**
 * Compile the one canonical SQL relation for a resolved collection navigation.
 *
 * Query compilation and authorization use the same relation and correlation
 * semantics; only the parent identity expression and aliases differ.
 * @param resolved - Canonical collection relation.
 * @param parentId - SQL expression for the owning row's universal identity.
 * @param aliases - Aliases reserved by the caller.
 * @returns The relation and its correlated condition.
 */
export function collectionSqlRelation(
  resolved: ResolvedCollectionRelation,
  parentId: string,
  aliases: CollectionSqlAliases,
): CollectionSqlRelation {
  if (resolved.collection.kind === 'explicit') {
    throw new Error('Explicit Collections are not supported by the query compiler yet')
  }
  if (resolved.target.kind !== 'entity') {
    throw new Error('Record Collections are not supported by the query compiler yet')
  }
  const targetName = resolved.target.definition.name
  const source = resolved.source
  if (source.kind === 'inverse') {
    if (targetName === 'Entity') {
      return {
        condition: `${quote(aliases.root)}.${quote('id')} = ${parentId}`,
        relation: `${quote('Entity')} ${quote(aliases.root)}`,
        rootAlias: aliases.root,
      }
    }
    const targetSource = `${quote(targetName)} ${quote(aliases.target)}`
    const rootSource = `${quote('Entity')} ${quote(aliases.root)}`
    const targetId = `${quote(aliases.target)}.${quote('id')}`
    const rootId = `${quote(aliases.root)}.${quote('id')}`
    return {
      condition: `${quote(aliases.target)}.${quote(resolved.owner.column)} = ${parentId}`,
      relation: `${targetSource} JOIN ${rootSource} ON ${rootId} = ${targetId}`,
      rootAlias: aliases.root,
      targetAlias: aliases.target,
    }
  }
  const relationship = source.relationship
  const remote = source.remote
  if (!remote) {
    throw new Error(`Collection relationship "${relationship.name}" has no related endpoint`)
  }
  const remoteColumn = quote(`${remote.field}.id`)
  const condition = `${quote(aliases.relationship)}.${quote(resolved.owner.column)} = ${parentId}`
  const relationshipSource = `${quote(relationship.name)} ${quote(aliases.relationship)}`
  const rootSource = `${quote('Entity')} ${quote(aliases.root)}`
  const rootId = `${quote(aliases.root)}.${quote('id')}`
  const remoteId = `${quote(aliases.relationship)}.${remoteColumn}`
  if (targetName === 'Entity') {
    return {
      condition,
      relation: `${relationshipSource} JOIN ${rootSource} ON ${rootId} = ${remoteId}`,
      relationshipAlias: aliases.relationship,
      rootAlias: aliases.root,
    }
  }
  const targetSource = `${quote(targetName)} ${quote(aliases.target)}`
  const targetId = `${quote(aliases.target)}.${quote('id')}`
  const targetJoin = `${relationshipSource} JOIN ${targetSource} ON ${targetId} = ${remoteId}`
  return {
    condition,
    relation: `${targetJoin} JOIN ${rootSource} ON ${rootId} = ${targetId}`,
    relationshipAlias: aliases.relationship,
    rootAlias: aliases.root,
    targetAlias: aliases.target,
  }
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Identifier text.
 * @returns The quoted identifier.
 */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
