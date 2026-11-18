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
  /** SQL expressions that identify one distinct result. */
  readonly identity: readonly string[],
  /** Whether identity is an Entity key or a composite record key. */
  readonly identityKind: 'entity' | 'record',
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
  if (collection.kind === 'explicit') {
    const relationship = collection.relationship
    const ownerColumn = `${collection.ownerEndpoint.field}.id`
    const relationshipSource = `${quote(relationship.name)} ${quote(aliases.relationship)}`
    if (collection.targetEndpoint === undefined) {
      return {
        condition: `${quote(aliases.relationship)}.${quote(ownerColumn)} = ${parentId}`,
        identity: relationship.between.map(endpoint => (
          `${quote(aliases.relationship)}.${quote(`${endpoint.field}.id`)}`
        )),
        identityKind: 'record',
        relation: relationshipSource,
        relationshipAlias: aliases.relationship,
        rootAlias: aliases.relationship,
      }
    }
    const targetColumn = `${collection.targetEndpoint.field}.id`
    const condition = `${quote(aliases.relationship)}.${quote(ownerColumn)} = ${parentId}`
    if (targetName === 'Entity') {
      const rootSource = `${quote('Entity')} ${quote(aliases.root)}`
      return {
        condition,
        identity: [`${quote(aliases.root)}.${quote('id')}`],
        identityKind: 'entity',
        relation:
          `${relationshipSource} JOIN ${rootSource} ON ` +
          `${quote(aliases.root)}.${quote('id')} = ` +
          `${quote(aliases.relationship)}.${quote(targetColumn)}`,
        relationshipAlias: aliases.relationship,
        rootAlias: aliases.root,
      }
    }
    const targetSource = `${quote(targetName)} ${quote(aliases.target)}`
    const rootSource = `${quote('Entity')} ${quote(aliases.root)}`
    return {
      condition,
      identity: [`${quote(aliases.target)}.${quote('id')}`],
      identityKind: 'entity',
      relation:
        `${relationshipSource} JOIN ${targetSource} ON ` +
        `${quote(aliases.target)}.${quote('id')} = ` +
        `${quote(aliases.relationship)}.${quote(targetColumn)} JOIN ${rootSource} ON ` +
        `${quote(aliases.root)}.${quote('id')} = ${quote(aliases.target)}.${quote('id')}`,
      relationshipAlias: aliases.relationship,
      rootAlias: aliases.root,
      targetAlias: aliases.target,
    }
  }
  if (collection.kind === 'inverse') {
    if (targetName === 'Entity') {
      return {
        condition: `${quote(aliases.root)}.${quote('id')} = ${parentId}`,
        identity: [`${quote(aliases.root)}.${quote('id')}`],
        identityKind: 'entity',
        relation: `${quote('Entity')} ${quote(aliases.root)}`,
        rootAlias: aliases.root,
      }
    }
    const targetSource = `${quote(targetName)} ${quote(aliases.target)}`
    const rootSource = `${quote('Entity')} ${quote(aliases.root)}`
    const targetId = `${quote(aliases.target)}.${quote('id')}`
    const rootId = `${quote(aliases.root)}.${quote('id')}`
    return {
      condition: `${quote(aliases.target)}.${quote(collection.reference.column)} = ${parentId}`,
      identity: [`${quote(aliases.target)}.${quote('id')}`],
      identityKind: 'entity',
      relation: `${targetSource} JOIN ${rootSource} ON ${rootId} = ${targetId}`,
      rootAlias: aliases.root,
      targetAlias: aliases.target,
    }
  }

  throw new Error('Unsupported collection kind')
}

/**
 * Quote a PostgreSQL identifier.
 * @param identifier - Identifier text.
 * @returns The quoted identifier.
 */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
