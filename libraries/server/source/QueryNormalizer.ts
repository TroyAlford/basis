import type { EntityDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Predicate } from './Predicate'
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
   * @returns The canonical filter, or null for empty source.
   * @throws {Error} When the source is invalid or references incompatible metadata.
   */
  normalize(entity: EntityDefinition, source: string): Filter | null {
    const result = QueryParser.parse(source)
    if (!result.expression) {
      if (result.diagnostics.length === 0) return null
      const [first] = result.diagnostics
      throw new Error(`Invalid where query at ${first?.start ?? 0}: ${first?.message ?? 'Invalid syntax'}`)
    }
    return expression(entity, result.expression)
  },
}

/**
 * Normalize one syntax expression.
 * @param entity - Entity whose fields are referenced.
 * @param node - Syntax expression.
 * @returns The canonical filter.
 */
function expression(entity: EntityDefinition, node: QueryExpression): Filter {
  if (node.kind === 'group') return expression(entity, node.expression)
  if (node.kind === 'logical') {
    return Predicate.logical(
      node.operator,
      node.filters.map(filter => expression(entity, filter)),
    )
  }
  return comparison(entity, node)
}

/**
 * Normalize one comparison expression.
 * @param entity - Entity whose fields are referenced.
 * @param node - Comparison syntax expression.
 * @returns The canonical comparison filter.
 */
function comparison(entity: EntityDefinition, node: QueryComparison): Filter {
  const field = Predicate.field(entity, node.field)

  if (node.operator === Operator.Comparison.Empty) {
    assertValues(node, 0)
    return Predicate.empty(entity, field)
  }

  if (node.operator === Operator.Comparison.Between) {
    assertValues(node, 2)
    const [lower, upper] = node.values as readonly [QueryLiteral, QueryLiteral]
    return Predicate.between(
      field.name,
      literal(field, lower),
      literal(field, upper),
    )
  }

  assertValues(node, 1)
  const value = literal(field, node.values[0] as QueryLiteral)
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
 * @param field - Target field definition.
 * @param node - Syntax literal.
 * @returns The typed canonical operand.
 */
function literal(field: ScalarFieldDefinition, node: QueryLiteral): unknown {
  if (node.kind === 'null') return null

  if (field.type === FieldType.Snowflake) {
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
      || field.type === FieldType.Timestamp
      || field.type === FieldType.UUID)
    && node.kind === 'string'
  ) {
    return node.value
  }

  throw new Error(`Query operand for "${field.name}" is not a valid ${field.type} value`)
}
