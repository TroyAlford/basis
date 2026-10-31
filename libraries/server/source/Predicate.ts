import type { EntityDefinition, FieldDefinition } from './EntityDefinitions'
import { Operator } from './Operator'

/** The kind of one normalized predicate node. */
export enum PredicateKind {
  /** A field/value comparison. */
  Comparison = 'comparison',
  /** A logical group of child predicates. */
  Logical = 'logical',
}

/** A normalized, validated where expression. */
export type Predicate =
  | {
    readonly field: FieldDefinition,
    readonly kind: PredicateKind.Comparison,
    readonly operator: Operator.Comparison,
    readonly value: unknown,
  }
  | {
    readonly kind: PredicateKind.Logical,
    readonly operands: readonly Predicate[],
    readonly operator: Operator.Logical,
  }

/** The recognized comparison wire values, resolved once from the enum. */
const COMPARISON_OPERATORS = new Set<string>(Object.values(Operator.Comparison))

/**
 * Normalize structured where JSON into the semantic predicate tree.
 *
 * This is the only structured-input normalizer. SQL rendering and parameter
 * binding belong to the SQL construction owner.
 */
export const Predicate = {
  /**
   * Normalize a where object.
   * @param entity - Entity whose fields are referenced.
   * @param where - Shorthand equality, structured comparisons, or logical groups.
   * @returns The root predicate, or null for an empty where object.
   * @throws {Error} When the expression shape, field, or operator is invalid.
   */
  normalize(entity: EntityDefinition, where: Readonly<Record<string, unknown>>): Predicate | null {
    if (!isPlainRecord(where)) throw new Error('Query where must be a plain object')

    const fields = new Map(entity.fields.map(field => [field.name, field]))
    const nodes = expression(entity, fields, where)
    return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] as Predicate : {
      kind: PredicateKind.Logical,
      operands: nodes,
      operator: Operator.Logical.And,
    }
  },
}

/**
 * Normalize every entry in one expression object, preserving encounter order.
 * @param entity - Entity whose fields are referenced.
 * @param fields - Field lookup for the entity.
 * @param where - Expression object.
 * @returns Predicate nodes in encounter order.
 */
function expression(
  entity: EntityDefinition,
  fields: ReadonlyMap<string, FieldDefinition>,
  where: Readonly<Record<string, unknown>>,
): Predicate[] {
  const nodes: Predicate[] = []

  for (const [name, value] of Object.entries(where)) {
    if (name === Operator.Logical.And) {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Query ${Operator.Logical.And} must be a non-empty array`)
      }
      const operands = value.map(operand => {
        if (!isPlainRecord(operand)) throw new Error(`Query ${Operator.Logical.And} operands must be plain objects`)
        const normalized = Predicate.normalize(entity, operand)
        if (!normalized) throw new Error(`Query ${Operator.Logical.And} operands must be non-empty objects`)
        return normalized
      })
      nodes.push({ kind: PredicateKind.Logical, operands, operator: Operator.Logical.And })
      continue
    }

    if (name.startsWith('$')) throw new Error(`Query operator "${name}" is not supported`)

    const field = fields.get(name)
    if (!field) throw new Error(`Unknown field "${entity.name}.${name}"`)

    if (isPlainRecord(value)) {
      const operators = Object.entries(value)
      if (operators.length === 0) {
        throw new Error(`Query condition "${entity.name}.${name}" must include an operator`)
      }
      const comparisons = operators.map(([operatorName, operand]) => {
        if (!COMPARISON_OPERATORS.has(operatorName)) {
          throw new Error(`Query operator "${operatorName}" is not supported`)
        }
        return {
          field,
          kind: PredicateKind.Comparison as const,
          operator: operatorName as Operator.Comparison,
          value: operand,
        }
      })
      nodes.push(comparisons.length === 1 ? comparisons[0] as Predicate : {
        kind: PredicateKind.Logical,
        operands: comparisons,
        operator: Operator.Logical.And,
      })
      continue
    }

    if (Array.isArray(value)) {
      throw new Error(`Query condition "${entity.name}.${name}" must be a scalar value`)
    }
    if (value === undefined) {
      throw new Error(`Query condition "${entity.name}.${name}" must not be undefined`)
    }

    nodes.push({ field, kind: PredicateKind.Comparison, operator: Operator.Comparison.Equal, value })
  }

  return nodes
}

/**
 * Whether a value is a plain object, excluding dates and arrays.
 * @param value - Candidate value.
 * @returns `true` for a plain object.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
