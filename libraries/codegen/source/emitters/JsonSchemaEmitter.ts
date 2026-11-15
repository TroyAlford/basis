import type { EffectiveFieldDefinition, EntityDefinition, Graph, ScalarFieldDefinition } from 'basis/server'
import { FieldType, SNOWFLAKE_IDENTITY_PATTERN, UUID_IDENTITY_PATTERN } from 'basis/server'
import type { EmittedFile } from '../emitter'
import { emitter } from '../emitter'

/** Generated JSON Schema by entity and operation. */
export type GeneratedSchemas = Readonly<Record<string, {
  /** Input schema for creates. */
  readonly create: Readonly<Record<string, unknown>>,
  /** Hydrated output schema. */
  readonly output: Readonly<Record<string, unknown>>,
  /** Input schema for updates. */
  readonly update: Readonly<Record<string, unknown>>,
}>>

/**
 * Generate deterministic JSON Schemas for every entity.
 * @param graph - Canonical application Graph.
 * @returns JSON Schema by entity and operation.
 */
export function generateJSONSchemas(graph: Graph): GeneratedSchemas {
  const definitions = graph.definitions
  const schemas: Record<string, {
    create: Readonly<Record<string, unknown>>,
    output: Readonly<Record<string, unknown>>,
    update: Readonly<Record<string, unknown>>,
  }> = {}
  for (const entity of definitions.entities) {
    const fields = entity.effectiveFields
      .filter(field => field.name !== 'id' && field.name !== 'name' && field.name !== 'entity')
    const generated = new Set(['lastUpdatedAt', 'lastUpdatedBy'])
    const writable = fields.filter(field => !generated.has(field.name))
    const writableProperties = Object.fromEntries(
      writable.map(field => [field.name, schemaForField(field, 'input', definitions)]),
    )
    const identity = identitySchema(entity.idFormat)
    const required = writable
      .filter(field => field.default === undefined && (
        field.type === FieldType.Entity ? field.nullable === false : field.nullable !== true
      ))
      .map(field => field.name)
    const outputProperties = {
      entity: discriminatorSchema(entity, definitions),
      id: identity,
      name: { type: 'string' },
      ...Object.fromEntries(fields.map(field => [field.name, schemaForField(field, 'output', definitions)])),
    }
    schemas[entity.name] = {
      create: {
        additionalProperties: false,
        properties: {
          id: identity,
          name: { type: 'string' },
          ...writableProperties,
        },
        required: [
          ...(entity.idFormat === 'Snowflake' ? ['id'] : []),
          'name',
          ...required,
        ],
        type: 'object',
      },
      output: {
        additionalProperties: false,
        properties: outputProperties,
        required: ['id', 'entity', 'name', ...required],
        type: 'object',
      },
      update: {
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          ...writableProperties,
        },
        type: 'object',
      },
    }
  }
  return schemas
}

/**
 * Generate the JSON Schema emitter file set.
 * @param graph - Canonical application Graph.
 * @returns One generated JSON Schema file.
 */
export function jsonSchemaOutput(graph: Graph): readonly EmittedFile[] {
  return [{
    content: `${JSON.stringify(generateJSONSchemas(graph), null, 2)}\n`,
    name: 'schemas',
  }]
}

/** Independently owned JSON Schema emitter. */
export const JsonSchemaEmitter = emitter(
  { extension: 'json', folder: 'json-schema' },
  jsonSchemaOutput,
)

// Emitter modules are discovered and invoked by their default export.
// eslint-disable-next-line @basis/no-default-export
export default JsonSchemaEmitter

/**
 * Render one field's JSON Schema.
 * @param field - Effective field.
 * @param mode - Input identifier or hydrated output shape.
 * @param definitions - Canonical definitions for concrete discriminator schemas.
 * @returns JSON Schema fragment.
 */
function schemaForField(
  field: EffectiveFieldDefinition,
  mode: 'input' | 'output',
  definitions: Graph['definitions'],
): Record<string, unknown> {
  if (field.type === FieldType.Entity) {
    if (mode === 'input') {
      return field.nullable === false
        ? { type: 'string' }
        : { type: ['string', 'null'] }
    }
    const reference = {
      properties: {
        entity: discriminatorSchemaForTarget(field.target, definitions),
        id: identitySchema(definitions.entity(field.target)?.idFormat),
        name: { type: 'string' },
      },
      required: ['id', 'name', 'entity'],
      type: 'object',
    }
    return field.nullable === false ? reference : { anyOf: [reference, { type: 'null' }] }
  }
  if (field.type === FieldType.Array) {
    return nullableSchema({
      items: schemaForScalar(field.items.type),
      type: 'array',
    }, field)
  }
  if (field.type === FieldType.JSON) {
    return field.nullable === true ? {} : { not: { type: 'null' } }
  }
  return nullableSchema({
    ...schemaForScalar(field.type),
    ...boundsFor(field),
  }, field)
}

/**
 * Allow null exactly when the canonical field is nullable.
 * @param schema - Non-null schema.
 * @param field - Effective field.
 * @returns The field schema with its null union.
 */
function nullableSchema(
  schema: Record<string, unknown>,
  field: EffectiveFieldDefinition,
): Record<string, unknown> {
  return field.nullable === true
    ? { anyOf: [schema, { type: 'null' }] }
    : schema
}

/**
 * Render the canonical root identity schema for one entity format.
 * @param format - Effective identity format, when refined.
 * @returns JSON Schema for the shared root `id` field.
 */
function identitySchema(
  format: 'Snowflake' | 'UUID' | undefined,
): Record<string, unknown> {
  if (format === 'UUID') return { pattern: UUID_IDENTITY_PATTERN, type: 'string' }
  if (format === 'Snowflake') {
    return { maxLength: 20, pattern: SNOWFLAKE_IDENTITY_PATTERN, type: 'string' }
  }
  return {
    anyOf: [
      { pattern: UUID_IDENTITY_PATTERN, type: 'string' },
      { maxLength: 20, pattern: SNOWFLAKE_IDENTITY_PATTERN, type: 'string' },
    ],
  }
}

/**
 * Render canonical scalar bounds as JSON Schema keywords.
 * @param field - Effective scalar field.
 * @returns JSON Schema bounds.
 */
function boundsFor(field: EffectiveFieldDefinition): Record<string, number> {
  if (field.type !== FieldType.Number && field.type !== FieldType.String) return {}
  return {
    ...(field.type === FieldType.Number && field.maximum !== undefined ? { maximum: field.maximum } : {}),
    ...(field.type === FieldType.Number && field.minimum !== undefined ? { minimum: field.minimum } : {}),
    ...(field.type === FieldType.String && field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.type === FieldType.String && field.minLength !== undefined ? { minLength: field.minLength } : {}),
  }
}

/**
 * Render the output discriminator for one concrete or abstract entity.
 * @param entity - Entity whose output is being described.
 * @param definitions - Canonical definitions.
 * @returns JSON Schema for the entity discriminator.
 */
function discriminatorSchema(
  entity: EntityDefinition,
  definitions: Graph['definitions'],
): Record<string, unknown> {
  if (!entity.abstract) return { const: entity.name, type: 'string' }
  return discriminatorSchemaForTarget(entity.name, definitions)
}

/**
 * Render a concrete-discriminator schema for a reference target.
 * @param target - Referenced entity name.
 * @param definitions - Canonical definitions.
 * @returns JSON Schema for the target discriminator.
 */
function discriminatorSchemaForTarget(
  target: string,
  definitions: Graph['definitions'],
): Record<string, unknown> {
  if (target === 'Entity') return { type: 'string' }
  const entity = definitions.entity(target)
  if (!entity || !entity.abstract) return { const: target, type: 'string' }
  const descendants = definitions.concreteDescendants(target).map(descendant => descendant.name)
  return descendants.length === 0
    ? { type: 'string' }
    : { enum: descendants, type: 'string' }
}

/**
 * Render one scalar JSON Schema.
 * @param type - Scalar field type.
 * @returns JSON Schema fragment.
 */
function schemaForScalar(type: ScalarFieldDefinition['type']): Record<string, unknown> {
  switch (type) {
    case FieldType.Boolean: return { type: 'boolean' }
    case FieldType.Number: return { type: 'number' }
    case FieldType.String: return { type: 'string' }
    case FieldType.Date: return { format: 'date', type: 'string' }
    case FieldType.Timestamp: return { format: 'date-time', type: 'string' }
    case FieldType.ID: return { type: 'string' }
    default: return {}
  }
}
