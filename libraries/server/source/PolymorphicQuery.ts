import type { EntityDefinition, EntityDefinitions, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import type { Filter } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import type { OrderBy, QueryScope } from './SQL'
import { SQL } from './SQL'

/** Options accepted by a polymorphic abstract-entity query. */
export interface PolymorphicQueryOptions {
  /** Effective scalar fields to project, in output order. */
  readonly fields: readonly string[],
  /** Maximum rows to return; defaults to 25, or `null` for unlimited. */
  readonly limit?: number | null,
  /** Rows to skip; defaults to 0. */
  readonly offset?: number,
  /** Explicit effective-field ordering, single or multi-level. */
  readonly orderBy?: OrderBy,
  /** Effective-field predicate. */
  readonly where?: Filter | Readonly<Record<string, unknown>> | string,
}

/** A compiled polymorphic query. */
export interface CompiledPolymorphicQuery {
  /** Complete SQL statement. */
  readonly sql: string,
  /** Values bound to `$1`, `$2`, … in order. */
  readonly values: readonly unknown[],
}

/**
 * Compile one query over all concrete descendants of an abstract entity.
 *
 * The abstract table supplies one shared ancestor row per descendant. Root
 * joins supply the universal name and leaf discriminator; ancestor joins
 * supply inherited fields. The result is one SQL statement, never a row-by-row
 * expansion.
 * @param entities - Canonical entity definitions.
 * @param definition - Abstract entity being queried.
 * @param options - Query options.
 * @returns The complete SQL and ordered bindings.
 */
export function compilePolymorphicQuery(
  entities: EntityDefinitions,
  definition: EntityDefinition,
  options: PolymorphicQueryOptions,
): CompiledPolymorphicQuery {
  if (options.fields.length === 0) throw new Error('Query fields must be a non-empty array')
  const effective = new Map(definition.effectiveFields.map(field => [field.name, field]))
  const baseAlias = 't'
  const rootAlias = 'r'
  const aliases = new Map<string, string>([
    ['Entity', rootAlias],
    [definition.name, baseAlias],
  ])
  const joins = [`JOIN "Entity" "${rootAlias}" ON "${rootAlias}"."id" = "${baseAlias}"."id"`]

  /**
   * Resolve or create a joined alias for one field owner.
   * @param owner - Owning entity table.
   * @returns Table alias.
   */
  const aliasFor = (owner: string): string => {
    const existing = aliases.get(owner)
    if (existing) return existing
    const alias = `o${aliases.size}`
    aliases.set(owner, alias)
    joins.push(`JOIN "${owner}" "${alias}" ON "${alias}"."id" = "${baseAlias}"."id"`)
    return alias
  }

  const field = (name: string): ScalarFieldDefinition => {
    const value = effective.get(name)
    if (!value) throw new Error(`Unknown field "${definition.name}.${name}"`)
    if (value.type === FieldType.Entity) {
      throw new Error(
        `Query field "${definition.name}.${name}" is an entity reference; graph projections are not supported yet`,
      )
    }
    return value
  }

  const expression = (value: ScalarFieldDefinition): string => {
    const owner = effective.get(value.name)?.owner
    if (!owner) throw new Error(`Unknown field "${definition.name}.${value.name}"`)
    if (owner === 'Entity') return `${rootAlias}.${quote(value.name)}`
    return `${aliasFor(owner)}.${quote(value.name)}`
  }

  const synthetic: EntityDefinition = { ...definition, fields: definition.effectiveFields }
  const scope: QueryScope = { definition: synthetic, expression, field }
  const selected = options.fields.map(name => {
    const value = field(name)
    return `${expression(value)} AS ${quote(name)}`
  })
  const where = typeof options.where === 'string'
    ? QueryNormalizer.normalize(synthetic, options.where) ?? undefined
    : options.where
  const predicate = SQL.where(entities, definition.name, where, scope)
  const ordering = options.orderBy === undefined
    ? `ORDER BY ${rootAlias}."name" ASC, ${rootAlias}."id" ASC`
    : `${SQL.orderBy(entities, definition.name, options.orderBy, scope).sql}, ${rootAlias}."id" ASC`
  const leaves = entities.entities
    .filter(entity => !entity.abstract && descendsFrom(entities, entity, definition.name))
    .map(entity => quoteLiteral(entity.name))
  const leafFilter = leaves.length === 0
    ? 'FALSE'
    : `${rootAlias}."entity" IN (${leaves.join(', ')})`
  const conditions = [leafFilter, ...(predicate.sql === '' ? [] : [predicate.sql.replace(/^WHERE /u, '')])]
  const limit = options.limit === undefined ? 25 : options.limit
  const pagination = SQL.paginate(limit, options.offset ?? 0, predicate.values.length)
  return {
    sql: [
      `SELECT ${selected.join(', ')}`,
      `FROM ${quote(definition.name)} "${baseAlias}"`,
      ...joins,
      `WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}`,
      ordering,
      pagination.sql,
    ].filter(part => part !== '').join(' '),
    values: [...predicate.values, ...pagination.values],
  }
}

/**
 * Whether an entity descends from an ancestor.
 * @param entities - Canonical definitions.
 * @param entity - Candidate entity.
 * @param ancestor - Ancestor name.
 * @returns `true` when the entity is the ancestor or a descendant.
 */
function descendsFrom(
  entities: EntityDefinitions,
  entity: EntityDefinition,
  ancestor: string,
): boolean {
  let current: string | undefined = entity.name
  while (current !== undefined) {
    if (current === ancestor) return true
    current = entities.entity(current)?.parent
    if (current === 'Entity') return false
  }
  return false
}

/**
 * Quote a PostgreSQL identifier.
 * @param value - Identifier.
 * @returns Quoted identifier.
 */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Quote a PostgreSQL string literal.
 * @param value - Literal value.
 * @returns Quoted literal.
 */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
