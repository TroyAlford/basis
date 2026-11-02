import type { Rule } from 'eslint'

/** Canonical entity property order. */
const ENTITY_KEYS = ['name', 'extends', 'fields'] as const
/** Canonical field property order. */
const FIELD_KEYS = ['field', 'type', 'format', 'target', 'column'] as const
/** Exact scalar field types. */
const FIELD_TYPES = new Set(['Boolean', 'Date', 'ID', 'Number', 'String', 'Timestamp'])
/** Formats accepted only on the inherited `id` refinement. */
const FORMATS = new Set(['Snowflake', 'UUID'])

/**
 * Validate and format an entity document.
 * @param value - Parsed JSON value.
 * @returns Formatted JSON and validation messages.
 */
export function formatEntityDocument(value: unknown): { formatted: string, issues: string[] } {
  const issues: string[] = []
  if (!isRecord(value) || !Array.isArray(value.entities)) {
    return { formatted: '', issues: ['entity document must contain a top-level entities array'] }
  }
  const entities = value.entities.map((entity, entityIndex) => {
    if (!isRecord(entity)) {
      issues.push(`entities[${entityIndex}] must be an object`)
      return entity
    }
    assertOrder(entity, ENTITY_KEYS, `entities[${entityIndex}]`, issues)
    if (typeof entity.name !== 'string') issues.push(`entities[${entityIndex}].name must be a string`)
    if (entity.extends !== undefined && typeof entity.extends !== 'string') {
      issues.push(`entities[${entityIndex}].extends must be a string`)
    }
    if (!Array.isArray(entity.fields)) {
      issues.push(`entities[${entityIndex}].fields must be an array`)
      return ordered(entity, ENTITY_KEYS)
    }
    const fields = entity.fields.map((field, fieldIndex) => {
      if (!isRecord(field)) {
        issues.push(`entities[${entityIndex}].fields[${fieldIndex}] must be an object`)
        return field
      }
      assertOrder(field, FIELD_KEYS, `entities[${entityIndex}].fields[${fieldIndex}]`, issues)
      if (typeof field.field !== 'string') {
        issues.push(`entities[${entityIndex}].fields[${fieldIndex}].field must be a string`)
      }
      if (field.field === 'id') {
        if (field.type !== undefined) {
          issues.push(`entities[${entityIndex}].fields[${fieldIndex}] id refinement must not declare type`)
        }
        if (typeof field.format !== 'string' || !FORMATS.has(field.format)) {
          issues.push(`entities[${entityIndex}].fields[${fieldIndex}] id refinement needs format UUID or Snowflake`)
        }
      } else if (field.type === 'Entity') {
        if (typeof field.target !== 'string') {
          issues.push(`entities[${entityIndex}].fields[${fieldIndex}].target must be a string`)
        }
        if (typeof field.column !== 'string') {
          issues.push(`entities[${entityIndex}].fields[${fieldIndex}].column must be a string`)
        }
      } else if (typeof field.type !== 'string' || !FIELD_TYPES.has(field.type)) {
        issues.push(`entities[${entityIndex}].fields[${fieldIndex}] has an invalid type`)
      }
      return ordered(field, FIELD_KEYS)
    })
    return ordered({ ...entity, fields }, ENTITY_KEYS)
  })
  return {
    formatted: `${JSON.stringify({ entities }, null, 2)}\n`,
    issues,
  }
}

/**
 * Check canonical key order.
 * @param value - Object.
 * @param keys - Canonical key order.
 * @param path - Diagnostic path.
 * @param issues - Mutable issue list.
 */
function assertOrder(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push(`${path} has unknown property "${key}"`)
  }
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
