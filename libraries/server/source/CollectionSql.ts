import type { DerivedCollectionDefinition } from './EntityDefinitions'

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
 * Compile the one canonical SQL relation for a collection navigation.
 *
 * Query compilation and authorization use the same relation and correlation
 * semantics; only the parent identity expression and aliases differ.
 * @param collection - Derived collection navigation.
 * @param parentId - SQL expression for the owning row's universal identity.
 * @param aliases - Aliases reserved by the caller.
 * @returns The relation and its correlated condition.
 */
export function collectionSqlRelation(
  collection: DerivedCollectionDefinition,
  parentId: string,
  aliases: CollectionSqlAliases,
): CollectionSqlRelation {
  const targetName = collection.target
  if (collection.kind === 'inverse') {
    if (targetName === 'Entity') {
      return {
        condition: `${quote(aliases.root)}.${quote('id')} = ${parentId}`,
        relation: `${quote('Entity')} ${quote(aliases.root)}`,
        rootAlias: aliases.root,
      }
    }
    return {
      condition: `${quote(aliases.target)}.${quote(collection.reference.column)} = ${parentId}`,
      relation: `${quote(targetName)} ${quote(aliases.target)} JOIN ${quote('Entity')} ${quote(aliases.root)} ` +
        `ON ${quote(aliases.root)}.${quote('id')} = ${quote(aliases.target)}.${quote('id')}`,
      rootAlias: aliases.root,
      targetAlias: aliases.target,
    }
  }
  const relationship = collection.relationship
  const local = relationship.between[collection.endpoint]
  const remote = relationship.between[collection.endpoint === 0 ? 1 : 0]
  const remoteColumn = quote(`${remote.field}.id`)
  const condition = `${quote(aliases.relationship)}.${quote(`${local.field}.id`)} = ${parentId}`
  if (targetName === 'Entity') {
    return {
      condition,
      relation: `${quote(relationship.name)} ${quote(aliases.relationship)} ` +
        `JOIN ${quote('Entity')} ${quote(aliases.root)} ` +
        `ON ${quote(aliases.root)}.${quote('id')} = ${quote(aliases.relationship)}.${remoteColumn}`,
      relationshipAlias: aliases.relationship,
      rootAlias: aliases.root,
    }
  }
  return {
    condition,
    relation: `${quote(relationship.name)} ${quote(aliases.relationship)} ` +
      `JOIN ${quote(targetName)} ${quote(aliases.target)} ` +
      `ON ${quote(aliases.target)}.${quote('id')} = ${quote(aliases.relationship)}.${remoteColumn} ` +
      `JOIN ${quote('Entity')} ${quote(aliases.root)} ` +
      `ON ${quote(aliases.root)}.${quote('id')} = ${quote(aliases.target)}.${quote('id')}`,
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
