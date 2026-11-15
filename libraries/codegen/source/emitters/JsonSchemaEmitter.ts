import type { EffectiveFieldDefinition, EntityDefinition, FieldDefinition, Graph, ScalarArrayElementDefinition, ScalarFieldDefinition } from 'basis/server'
import { FieldType, SNOWFLAKE_IDENTITY_PATTERN, UUID_IDENTITY_PATTERN } from 'basis/server'
import type { EmittedFile } from '../emitter'
import { emitter } from '../emitter'

/** One interoperable JSON Schema document describing the canonical Graph. */
export interface GeneratedSchemas {
  /** Canonical entity definitions by name. */
  readonly $defs: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  /** Root reference to the universal Entity definition. */
  readonly $ref: string,
  /** JSON Schema dialect used by the document. */
  readonly $schema: string,
}

/**
 * Generate a standards-compliant JSON Schema document for the canonical Graph.
 * @param graph - Canonical application Graph.
 * @returns One JSON Schema document whose definitions describe the entities.
 */
export function generateJSONSchemas(graph: Graph): GeneratedSchemas {
  const definitions = graph.definitions
  const entityDefinitions = [...definitions.entities]
    .sort((left, right) => left.name.localeCompare(right.name))
  return {
    $defs: {
      Entity: rootEntitySchema(),
      Reference: referenceSchema(definitions),
      ...Object.fromEntries(entityDefinitions.map(entity => [
        entity.name,
        entitySchema(entity, definitions),
      ])),
    },
    $ref: '#/$defs/Entity',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
  }
}

/**
 * Render the universal Entity root definition.
 * @returns Entity JSON Schema.
 */
function rootEntitySchema(): Readonly<Record<string, unknown>> {
  return {
    allOf: [{ $ref: '#/$defs/Reference' }],
    properties: {
      lastUpdatedAt: {
        anyOf: [{ format: 'date-time', type: 'string' }, { type: 'null' }],
      },
      lastUpdatedBy: {
        anyOf: [{ $ref: '#/$defs/Reference' }, { type: 'null' }],
      },
    },
    required: ['lastUpdatedAt', 'lastUpdatedBy'],
    type: 'object',
  }
}

/**
 * Render the canonical Reference identity shape.
 * @param definitions - Canonical definitions.
 * @returns Reference JSON Schema.
 */
function referenceSchema(
  definitions: Graph['definitions'],
): Readonly<Record<string, unknown>> {
  return {
    properties: {
      entity: rootDiscriminatorSchema(definitions),
      id: identitySchema(undefined),
      name: { type: 'string' },
    },
    required: ['id', 'name', 'entity'],
    type: 'object',
  }
}

/**
 * Render one entity definition with its local fields and parent reference.
 * @param entity - Entity definition.
 * @param definitions - Canonical definitions.
 * @returns Entity JSON Schema.
 */
function entitySchema(
  entity: EntityDefinition,
  definitions: Graph['definitions'],
): Readonly<Record<string, unknown>> {
  const properties: Record<string, unknown> = {
    entity: discriminatorSchema(entity, definitions),
  }
  const required = ['entity']
  if (entity.idFormat !== undefined) properties.id = identitySchema(entity.idFormat)
  for (const field of entity.fields) {
    if (field.type === FieldType.Inverse || field.name === 'id') continue
    properties[field.name] = fieldSchema(field)
    required.push(field.name)
  }
  return {
    allOf: [{ $ref: `#/$defs/${entity.parent}` }],
    properties,
    required,
    type: 'object',
  }
}

/**
 * Render one field's JSON Schema.
 * @param field - Field definition.
 * @returns JSON Schema fragment.
 */
function fieldSchema(field: FieldDefinition): Record<string, unknown> {
  if (field.type === FieldType.Inverse) return {}
  if (field.type === FieldType.Entity) {
    const reference = { $ref: '#/$defs/Reference' }
    return field.nullable === false ? reference : { anyOf: [reference, { type: 'null' }] }
  }
  if (field.type === FieldType.Array) {
    return nullableSchema({
      items: itemSchema(field.items),
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
 * @param field - Field definition.
 * @param field.nullable - Whether the field accepts null.
 * @returns The field schema with its null union.
 */
function nullableSchema(
  schema: Record<string, unknown>,
  field: { readonly nullable?: boolean },
): Record<string, unknown> {
  return field.nullable === true
    ? { anyOf: [schema, { type: 'null' }] }
    : schema
}

/**
 * Render one native-array item schema.
 * @param item - Array element definition.
 * @returns JSON Schema fragment.
 */
function itemSchema(item: ScalarArrayElementDefinition): Record<string, unknown> {
  if (item.type === FieldType.ID) return identitySchema(item.format)
  return schemaForScalar(item.type)
}

/**
 * Render the canonical identity schema for one entity format.
 * @param format - Effective identity format, when refined.
 * @returns JSON Schema for an ID value.
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
function boundsFor(field: EffectiveFieldDefinition | FieldDefinition): Record<string, number> {
  if (field.type !== FieldType.Number && field.type !== FieldType.String) return {}
  return {
    ...(field.type === FieldType.Number && field.maximum !== undefined ? { maximum: field.maximum } : {}),
    ...(field.type === FieldType.Number && field.minimum !== undefined ? { minimum: field.minimum } : {}),
    ...(field.type === FieldType.String && field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.type === FieldType.String && field.minLength !== undefined ? { minLength: field.minLength } : {}),
  }
}

/**
 * Render the universal root discriminator union.
 * @param definitions - Canonical definitions.
 * @returns JSON Schema for the root discriminator.
 */
function rootDiscriminatorSchema(
  definitions: Graph['definitions'],
): Record<string, unknown> {
  const leaves = definitions.concreteDescendants('Entity')
    .map(entity => entity.name)
    .sort((left, right) => left.localeCompare(right))
  return leaves.length === 0 ? { type: 'string' } : { enum: leaves, type: 'string' }
}

/**
 * Render the discriminator for one concrete or abstract entity.
 * @param entity - Entity whose representation is being described.
 * @param definitions - Canonical definitions.
 * @returns JSON Schema for the entity discriminator.
 */
function discriminatorSchema(
  entity: EntityDefinition,
  definitions: Graph['definitions'],
): Record<string, unknown> {
  if (!entity.abstract) return { const: entity.name, type: 'string' }
  return {
    enum: definitions.concreteDescendants(entity.name)
      .map(descendant => descendant.name)
      .sort((left, right) => left.localeCompare(right)),
    type: 'string',
  }
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
export default JsonSchemaEmitter
