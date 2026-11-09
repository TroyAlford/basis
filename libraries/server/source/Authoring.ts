import type { EffectiveFieldDefinition, EntityDefinition, EntityDefinitions, FieldDefinition, ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType } from './EntityDefinitions'

/** Generated TypeScript source. */
export interface GeneratedProducts {
  /** Logical Mermaid entity relationship diagram. */
  readonly logicalErd: string,
  /** Physical Mermaid table relationship diagram. */
  readonly physicalErd: string,
  /** Generated JSON Schema by entity and operation. */
  readonly schemas: Readonly<Record<string, {
    readonly create: Readonly<Record<string, unknown>>,
    readonly output: Readonly<Record<string, unknown>>,
    readonly update: Readonly<Record<string, unknown>>,
  }>>,
  /** Generated TypeScript source. */
  readonly types: string,
}

/**
 * Generate deterministic types, JSON Schemas, and ERDs from one canonical model.
 * @param definitions - Validated canonical definitions.
 * @returns All generated products.
 */
export function generateProducts(definitions: EntityDefinitions): GeneratedProducts {
  return {
    logicalErd: generateErd(definitions, 'logical'),
    physicalErd: generateErd(definitions, 'physical'),
    schemas: generateJSONSchemas(definitions),
    types: generateTypes(definitions),
  }
}

/**
 * Generate TypeScript entity, reference, and projection types.
 * @param definitions - Validated canonical definitions.
 * @returns Deterministic TypeScript source.
 */
export function generateTypes(definitions: EntityDefinitions): string {
  const lines: string[] = [
    '/** Generated from the canonical Basis entity definitions. Do not edit by hand. */',
    '',
    'export interface Entity {',
    '  readonly id: string',
    '  readonly name: string',
    '  readonly entity: string',
    '}',
    '',
    "export type EntityRef = Pick<Entity, 'id' | 'name' | 'entity'>",
    '',
  ]
  for (const entity of definitions.entities) {
    lines.push(`export interface ${entity.name} extends Entity {`)
    const discriminator = entity.abstract
      ? definitions.concreteDescendants(entity.name).map(descendant => `'${descendant.name}'`).join(' | ')
      : `'${entity.name}'`
    lines.push(`  readonly entity: ${discriminator || 'string'}`)
    for (const field of entity.effectiveFields) {
      if (field.name === 'id' || field.name === 'name' || field.name === 'entity') continue
      lines.push(`  readonly ${field.name}: ${fieldType(field)}`)
    }
    lines.push('}')
    lines.push('')
    lines.push(`export type ${entity.name}Ref = Pick<${entity.name}, 'id' | 'name' | 'entity'>`)
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

/**
 * Generate deterministic JSON Schemas for every entity.
 * @param definitions - Validated canonical definitions.
 * @returns JSON Schema by entity and operation.
 */
export function generateJSONSchemas(
  definitions: EntityDefinitions,
): GeneratedProducts['schemas'] {
  const schemas: Record<string, {
    create: Readonly<Record<string, unknown>>,
    output: Readonly<Record<string, unknown>>,
    update: Readonly<Record<string, unknown>>,
  }> = {}
  for (const entity of definitions.entities) {
    const fields = entity.effectiveFields
      .filter(field => field.name !== 'id' && field.name !== 'name' && field.name !== 'entity')
    const base = {
      entity: discriminatorSchema(entity, definitions),
      id: { type: 'string' },
      name: { type: 'string' },
    }
    const input = {
      ...base,
      ...Object.fromEntries(fields.map(field => [field.name, schemaForField(field, 'input', definitions)])),
    }
    const output = {
      ...base,
      entity: discriminatorSchema(entity, definitions),
      ...Object.fromEntries(fields.map(field => [field.name, schemaForField(field, 'output', definitions)])),
    }
    schemas[entity.name] = {
      create: { properties: input, required: ['entity', 'name'], type: 'object' },
      output: { properties: output, required: ['id', 'entity', 'name'], type: 'object' },
      update: { properties: input, type: 'object' },
    }
  }
  return schemas
}

/**
 * Generate a deterministic Mermaid ERD.
 * @param definitions - Validated canonical definitions.
 * @param mode - Logical entities or physical tables.
 * @returns Mermaid source.
 */
export function generateErd(
  definitions: EntityDefinitions,
  mode: 'logical' | 'physical' = 'logical',
): string {
  const physical = mode === 'physical' ? definitions.physicalSchema('basis_app', false, false) : null
  const lines = ['erDiagram']
  if (physical) {
    for (const table of physical.tables) {
      lines.push(`  ${table.name} {`)
      for (const column of table.columns) lines.push(`    ${column.sqlType} ${column.name}`)
      lines.push('  }')
    }
  } else {
    lines.push('  Entity {')
    lines.push('    string id')
    lines.push('    string name')
    lines.push('    string entity')
    lines.push('  }')
    for (const entity of definitions.entities) {
      lines.push(`  ${entity.name} {`)
      for (const field of entity.effectiveFields) {
        lines.push(`    ${mermaidField(field)}`)
      }
      lines.push('  }')
    }
    for (const relationship of definitions.relationships) {
      lines.push(`  ${relationship.name} {`)
      for (const field of relationship.fields) lines.push(`    ${mermaidField(field)}`)
      lines.push('  }')
    }
  }

  const connect = (left: string, right: string, label: string, cardinality = '||--o{'): void => {
    lines.push(`  ${left} ${cardinality} ${right} : ${label}`)
  }

  if (physical) {
    for (const constraint of physical.constraints) {
      if (!constraint.target || !constraint.column) continue
      connect(constraint.target, constraint.table, constraint.column)
    }
  } else {
    for (const entity of definitions.entities) {
      connect(entity.parent, entity.name, 'extends')
      for (const field of entity.fields) {
        if (field.type !== FieldType.Entity) continue
        const association = definitions.association(entity.name, field.name)
        connect(
          field.target,
          entity.name,
          field.name,
          association?.cardinality === 'One' ? '||--o|' : '||--o{',
        )
      }
    }
    for (const relationship of definitions.relationships) {
      const [left, right] = relationship.between
      connect(left.target, relationship.name, left.field)
      connect(right.target, relationship.name, right.field)
    }
  }
  return lines.join('\n')
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
  definitions: EntityDefinitions,
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
  return schemaForScalar(field.type)
}

/**
 * Render the output discriminator for one concrete or abstract entity.
 * @param entity - Entity whose output is being described.
 * @param definitions - Canonical definitions.
 * @returns JSON Schema for the entity discriminator.
 */
function discriminatorSchema(
  entity: EntityDefinition,
  definitions: EntityDefinitions,
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
  definitions: EntityDefinitions,
): Record<string, unknown> {
  if (target === 'Entity') return { type: 'string' }
  const entity = definitions.entity(target)
  if (!entity || !entity.abstract) {
    return { const: target, type: 'string' }
  }
  const descendants = definitions.concreteDescendants(target).map(descendant => descendant.name)
  return descendants.length === 0
    ? { type: 'string' }
    : { enum: descendants, type: 'string' }
}

/**
 * Render one field using Mermaid's whitespace-delimited type/name grammar.
 * @param field - Effective or relationship field.
 * @returns Mermaid attribute line body.
 */
function mermaidField(field: EffectiveFieldDefinition | FieldDefinition): string {
  if (field.type === FieldType.Entity) return `Ref ${field.name} "nullable"`
  if (field.type === FieldType.Array) return `${mermaidScalar(field.items.type)}[] ${field.name}`
  if (field.type === FieldType.JSON) return `json ${field.name}`
  if (field.type === FieldType.Inverse) return `unknown ${field.name}`
  return `${mermaidScalar(field.type)} ${field.name}`
}

/**
 * Render one scalar Mermaid attribute type.
 * @param type - Scalar field type.
 * @returns Single-token Mermaid type.
 */
function mermaidScalar(type: ScalarFieldDefinition['type']): string {
  switch (type) {
    case FieldType.Boolean: return 'boolean'
    case FieldType.Date: return 'date'
    case FieldType.Number: return 'number'
    case FieldType.String:
    case FieldType.ID: return 'string'
    case FieldType.Timestamp: return 'timestamptz'
    default: return 'unknown'
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
