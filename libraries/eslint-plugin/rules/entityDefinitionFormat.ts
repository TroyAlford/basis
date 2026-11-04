import type { Rule } from 'eslint'
import { EntityDefinitions } from '../../server/source/EntityDefinitions'

/** Canonical entity property order. */
const ENTITY_KEYS = ['name', 'extends', 'fields'] as const
/** Canonical field property order. */
const FIELD_KEYS = ['field', 'type', 'format', 'target', 'inverse', 'items'] as const
/** Canonical array element property order. */
const ELEMENT_KEYS = ['type', 'format'] as const
/** Canonical relationship property order. */
const RELATIONSHIP_KEYS = ['name', 'between', 'fields'] as const
/** Canonical relationship endpoint property order. */
const ENDPOINT_KEYS = ['field', 'target', 'inverse'] as const

/**
 * Validate and format an entity document.
 * @param value - Parsed JSON value.
 * @returns Formatted JSON and validation messages.
 */
export function formatEntityDocument(value: unknown): { formatted: string, issues: string[] } {
  if (!isRecord(value) || !Array.isArray(value.entities)) {
    return { formatted: '', issues: ['entity document must contain a top-level entities array'] }
  }
  try {
    EntityDefinitions.load(JSON.stringify(value))
  } catch (error) {
    return { formatted: '', issues: [(error as Error).message] }
  }
  const entities = value.entities.map(entity => {
    const record = entity as Record<string, unknown>
    const fields = (record.fields as unknown[]).map(field => orderField(
      field as Record<string, unknown>,
    ))
    return ordered({ ...record, fields }, ENTITY_KEYS)
  })
  let relationships: readonly unknown[] | undefined
  if (Array.isArray(value.relationships)) {
    relationships = value.relationships.map(relationship => (
      orderRelationship(relationship as Record<string, unknown>)
    ))
  }
  const document = relationships === undefined ? { entities } : { entities, relationships }
  return {
    formatted: `${JSON.stringify(document, null, 2)}\n`,
    issues: [],
  }
}

/**
 * Reorder one relationship and its endpoints canonically.
 * @param value - Relationship object.
 * @returns Ordered relationship.
 */
function orderRelationship(value: Record<string, unknown>): Record<string, unknown> {
  const between = Array.isArray(value.between)
    ? value.between.map(endpoint => ordered(endpoint as Record<string, unknown>, ENDPOINT_KEYS))
    : value.between
  const fields = Array.isArray(value.fields)
    ? value.fields.map(field => orderField(field as Record<string, unknown>))
    : value.fields
  return ordered({ ...value, between, fields }, RELATIONSHIP_KEYS)
}

/**
 * Reorder one field and any nested collection element canonically.
 * @param value - Field object.
 * @returns Ordered field.
 */
function orderField(value: Record<string, unknown>): Record<string, unknown> {
  const field = ordered(value, FIELD_KEYS)
  if (field.type === 'Array' && isRecord(field.items)) {
    field.items = ordered(field.items, ELEMENT_KEYS)
  }
  return field
}

/**
 * Reorder known keys canonically.
 * @param value - Object.
 * @param keys - Canonical key order.
 * @returns Ordered object.
 */
function ordered(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (value[key] !== undefined) result[key] = value[key]
  }
  return result
}

/**
 * Whether a value is a plain object.
 * @param value - Candidate.
 * @returns `true` for a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const entityDefinitionFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      Program(): void {
        let value: unknown
        try {
          value = JSON.parse(context.sourceCode.text)
        } catch {
          context.report({ messageId: 'invalidJson', node: context.sourceCode.ast })
          return
        }
        const result = formatEntityDocument(value)
        if (result.issues.length > 0) {
          context.report({
            data: { detail: result.issues.join('; ') },
            messageId: 'invalidEntity',
            node: context.sourceCode.ast,
          })
          return
        }
        if (result.formatted === context.sourceCode.text) return
        context.report({
          fix: fixer => fixer.replaceText(context.sourceCode.ast, result.formatted),
          messageId: 'formatEntity',
          node: context.sourceCode.ast,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Require canonical entity-document JSON ordering and vocabulary.',
    },
    fixable: 'code',
    messages: {
      formatEntity: 'Entity document is not in canonical format.',
      invalidEntity: 'Invalid entity document: {{detail}}',
      invalidJson: 'Entity document is not valid JSON.',
    },
    schema: [],
    type: 'layout',
  },
}
