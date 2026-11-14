import type { EffectiveFieldDefinition, EntityDefinition, FieldDefinition, Graph, ScalarFieldDefinition } from 'basis/server'
import { FieldType } from 'basis/server'

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
 * Generate TypeScript entity and reference types.
 * @param graph - Canonical application Graph.
 * @returns Deterministic TypeScript source.
 */
export function generateTypes(graph: Graph): string {
  const definitions = graph.definitions
  const root = `/** Generated from the canonical Basis entity definitions. Do not edit by hand. */

export interface Entity {
  readonly id: string
  readonly name: string
  readonly entity: string
}

export type EntityRef = Pick<Entity, 'id' | 'name' | 'entity'>`
  const entities = definitions.entities.map(entity => {
    const discriminator = entity.abstract
      ? definitions.concreteDescendants(entity.name).map(descendant => `'${descendant.name}'`).join(' | ')
      : `'${entity.name}'`
    const fields = entity.effectiveFields
      .filter(field => field.name !== 'id' && field.name !== 'name' && field.name !== 'entity')
      .map(field => `  readonly ${field.name}: ${fieldType(field)}`)
      .join('\n')
    return `export interface ${entity.name} extends Entity {
  readonly entity: ${discriminator || 'string'}${fields === '' ? '' : `\n${fields}`}
}

export type ${entity.name}Ref = Pick<${entity.name}, 'id' | 'name' | 'entity'>`
  }).join('\n\n')
  return `${root}\n\n${entities}\n`
}

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
    const base = {
      entity: { ...discriminatorSchema(entity, definitions), readOnly: true },
      id: { readOnly: true, type: 'string' },
      name: { type: 'string' },
    }
    const input = {
      ...base,
      ...Object.fromEntries(fields.map(field => [field.name, schemaForField(field, 'input', definitions)])),
    }
    const output = {
      ...base,
      entity: discriminatorSchema(entity, definitions),
      id: { type: 'string' },
      ...Object.fromEntries(fields.map(field => [field.name, schemaForField(field, 'output', definitions)])),
    }
    const required = fields
      .filter(field => field.default === undefined && (
        field.type === FieldType.Entity ? field.nullable === false : field.nullable !== true
      ))
      .map(field => field.name)
    schemas[entity.name] = {
      create: {
        properties: input,
        required: ['entity', 'name', ...required],
        type: 'object',
      },
      output: {
        properties: output,
        required: ['id', 'entity', 'name', ...required],
        type: 'object',
      },
      update: { properties: input, type: 'object' },
    }
  }
  return schemas
}

/**
 * Render one field's TypeScript type.
 * @param field - Effective field.
 * @returns TypeScript type expression.
 */
function fieldType(field: EffectiveFieldDefinition | FieldDefinition): string {
  if (field.type === FieldType.Entity) return `${field.target}Ref | null`
  if (field.type === FieldType.Array) return `readonly ${scalarType(field.items.type)}[]`
  if (field.type === FieldType.JSON) return 'unknown'
  if (field.type === FieldType.Inverse) return 'unknown'
  return scalarType(field.type)
}

/**
 * Render one scalar TypeScript type.
 * @param type - Scalar field type.
 * @returns TypeScript type expression.
 */
function scalarType(type: ScalarFieldDefinition['type']): string {
  switch (type) {
    case FieldType.Boolean: return 'boolean'
    case FieldType.Number: return 'number'
    case FieldType.String:
    case FieldType.Date:
    case FieldType.ID:
    case FieldType.Timestamp: return 'string'
    default: return 'unknown'
  }
}

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
    if (mode === 'input') return { type: ['string', 'null'] }
    return {
      anyOf: [{
        properties: {
          entity: discriminatorSchemaForTarget(field.target, definitions),
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name', 'entity'],
        type: 'object',
      }, { type: 'null' }],
    }
  }
  if (field.type === FieldType.Array) return {
    items: schemaForScalar(field.items.type),
    type: 'array',
  }
  if (field.type === FieldType.JSON) return {}
  const schema = {
    ...schemaForScalar(field.type),
    ...boundsFor(field),
  }
  return mode === 'input' && (field.name === 'lastUpdatedBy' || field.name === 'lastUpdatedAt')
    ? { ...schema, readOnly: true }
    : schema
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
