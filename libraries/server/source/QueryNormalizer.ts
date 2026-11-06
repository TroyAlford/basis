import type { EntityDefinition, QueryFieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { CollectionResolver, Filter } from './Predicate'
import { arrayItemField, Predicate } from './Predicate'
import type { QueryComparison, QueryExpression, QueryLiteral } from './QueryParser'
import { QueryParser } from './QueryParser'

/**
 * Normalize string query source into the canonical filter tree.
 *
 * Parsing preserves syntax provenance; this owner applies entity metadata to
 * type literals and lowers source-level operators into predicates.
 */
export const QueryNormalizer = {
  /**
   * Normalize string query source for one entity.
   * @param entity - Entity whose fields are referenced.
   * @param source - Query expression source.
   * @param resolve - Resolve a logical field or path to its scalar definition.
   * @param collection - Resolve collection navigations to related-item metadata.
   * @returns The canonical filter, or null for empty source.
   * @throws {Error} When the source is invalid or references incompatible metadata.
   */
  normalize(
    entity: EntityDefinition,
    source: string,
    resolve: (name: string) => QueryFieldDefinition = name => Predicate.field(entity, name),
    collection?: CollectionResolver,
  ): Filter | null {
    const result = QueryParser.parse(source)
    if (!result.expression) {
      if (result.diagnostics.length === 0) return null
      const [first] = result.diagnostics
      throw new Error(`Invalid where query at ${first?.start ?? 0}: ${first?.message ?? 'Invalid syntax'}`)
    }
    return expression(entity, result.expression, resolve, collection)
  },
}

/**
 * Normalize one syntax expression.
 * @param entity - Entity whose fields are referenced.
 * @param node - Syntax expression.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @param collection - Resolve collection navigations to related-item metadata.
 * @returns The canonical filter.
 */
function expression(
  entity: EntityDefinition,
  node: QueryExpression,
  resolve: (name: string) => QueryFieldDefinition,
  collection?: CollectionResolver,
): Filter {
  if (node.kind === 'group') return expression(entity, node.expression, resolve, collection)
  if (node.kind === 'logical') {
    return Predicate.logical(
      node.operator,
      node.filters.map(filter => expression(entity, filter, resolve, collection)),
    )
  }
  if (node.kind === 'collection') {
    const scope = collection?.(node.field)
    if (!scope) throw new Error(`Unknown collection navigation "${node.field}"`)
    const filters = node.filters.map(filter => expression(scope.definition, filter, scope.field))
    if (node.operator === Operator.Collection.All) return Predicate.universal(node.field, filters)
    return { field: node.field, filters, operator: node.operator }
  }
  return comparison(entity, node, resolve, collection)
}

/**
 * Normalize one comparison expression.
 * @param entity - Entity whose fields are referenced.
 * @param node - Comparison syntax expression.
 * @param resolve - Resolve a logical field or path to its scalar definition.
 * @param collection - Resolve collection navigations to related-item metadata.
 * @returns The canonical comparison filter.
 */
function comparison(
  entity: EntityDefinition,
  node: QueryComparison,
  resolve: (name: string) => QueryFieldDefinition,
  collection?: CollectionResolver,
): Filter {
  if (node.operator === Operator.Comparison.Empty) {
    assertValues(node, 0)
    const scope = collection?.(node.field)
    if (scope) return { field: node.field, filters: [], operator: node.operator }
  }

  if (node.operator === Operator.Comparison.Contains && collection?.(node.field)) {
    const value = node.values[0]
    if (value?.kind === 'array' && value.value.length === 0) {
      throw new Error('Collection $contains requires at least one requirement')
    }
    throw new Error('Collection $contains requires parenthesized requirements')
  }

  const field = resolve(node.field)

  if (node.operator === Operator.Comparison.Empty) return Predicate.empty(entity, field)

  if (node.operator === Operator.Comparison.Between) {
    if (field.type !== FieldType.String
      && field.type !== FieldType.Number
      && field.type !== FieldType.Date
      && field.type !== FieldType.Timestamp
      && field.type !== FieldType.ID) {
      throw new Error(`Query ${node.operator} is not valid for field "${node.field}"`)
    }
    assertValues(node, 2)
    const [lower, upper] = node.values as readonly [QueryLiteral, QueryLiteral]
    return Predicate.between(
      field.name,
      literal(field, lower),
      literal(field, upper),
    )
  }

  assertValues(node, 1)
  const raw = literal(field, node.values[0] as QueryLiteral)
  const value = Predicate.operand(field, node.operator, raw)
  if (node.operator === Operator.Comparison.NotEqual) return Predicate.notEqual(field.name, value)
  return { field: field.name, operator: node.operator, value }
}

/**
 * Require one comparison's source argument count.
 * @param node - Comparison syntax expression.
 * @param count - Required argument count.
 */
function assertValues(node: QueryComparison, count: number): void {
  if (node.values.length !== count) {
    throw new Error(`Query operator "${node.operator}" requires ${count} value(s)`)
  }
}

/**
 * Convert one syntax literal using the target field type.
 * @param field - Target value field.
 * @param node - Syntax literal.
 * @returns The typed canonical operand.
 */
function literal(field: QueryFieldDefinition, node: QueryLiteral): unknown {
  if (node.kind === 'array') {
    if (field.type === FieldType.Array) {
      const item = arrayItemField(field)
      return node.value.map(element => scalarLiteral(item, element))
    }
    if (field.type === FieldType.JSON) return jsonLiteral(node)
    throw new Error(`Query operand for "${field.name}" must not be an array literal`)
  }
  if (node.kind === 'object') {
    if (field.type === FieldType.JSON) return jsonLiteral(node)
    throw new Error(`Query operand for "${field.name}" must not be an object literal`)
  }
  if (field.type === FieldType.Array) return scalarLiteral(arrayItemField(field), node)
  if (field.type === FieldType.JSON) return jsonLiteral(node)
  return scalarLiteral(field, node)
}

/**
 * Convert one scalar syntax literal using its target field.
 * @param field - Target scalar field.
 * @param node - Scalar syntax literal.
 * @returns The typed scalar value.
 */
function scalarLiteral(field: ScalarFieldDefinition, node: QueryLiteral): unknown {
  if (node.kind === 'array' || node.kind === 'object') {
    throw new Error(`Query operand for "${field.name}" must be a scalar literal`)
  }
  if (node.kind === 'null') return null

  if (field.type === FieldType.ID) {
    if (node.kind === 'number') return node.raw
    if (node.kind === 'string') return node.value
  }

  if (field.type === FieldType.Number && node.kind === 'number') {
    const value = Number(node.raw)
    if (Number.isFinite(value)) return value
  }

  if (field.type === FieldType.Boolean && node.kind === 'boolean') return node.value

  if (
    (field.type === FieldType.Date
      || field.type === FieldType.String
      || field.type === FieldType.Timestamp)
    && node.kind === 'string'
  ) {
    return node.value
  }

  throw new Error(`Query operand for "${field.name}" is not a valid ${field.type.toLowerCase()} value`)
}

/**
 * Convert one parsed JSON literal recursively.
 * @param node - JSON syntax literal.
 * @returns A JSON-compatible value.
 */
function jsonLiteral(node: QueryLiteral): unknown {
  if (node.kind === 'array') return node.value.map(jsonLiteral)
  if (node.kind === 'object') {
    return Object.fromEntries(
      Object.entries(node.value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, jsonLiteral(value)]),
    )
  }
  if (node.kind === 'number') {
    const value = Number(node.raw)
    if (!Number.isFinite(value)) throw new Error('JSON number literals must be finite')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(`JSON integer literal ${node.raw} exceeds the safe integer range`)
    }
    return value
  }
  return node.value
}
