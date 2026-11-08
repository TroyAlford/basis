import type { EffectiveFieldDefinition, FieldDefinition, IdentityFormat, ScalarFieldDefinition } from './EntityDefinitions'
import { EntityDefinitions, FieldType } from './EntityDefinitions'

/** Navigation cardinality accepted by typed authoring. */
export enum Cardinality {
  /** A collection navigation. */
  Many = 'Many',
  /** A singular navigation. */
  One = 'One',
}

/** One authored scalar field. */
export interface AuthoredScalarField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** Scalar field type. */
  readonly type: FieldType.Boolean | FieldType.Date | FieldType.Number
    | FieldType.String | FieldType.Timestamp,
}

/** One authored `id` refinement. */
export interface AuthoredIdentityField {
  /** Universal identity field. */
  readonly field: 'id',
  /** Optional canonical identity format. */
  readonly format?: IdentityFormat,
}

/** One authored native array field. */
export interface AuthoredArrayField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** Scalar array element descriptor. */
  readonly items: {
    /** Optional identity format for ID elements. */
    readonly format?: IdentityFormat,
    /** Scalar element type. */
    readonly type: ScalarFieldDefinition['type'],
  },
  /** Array field type. */
  readonly type: FieldType.Array,
}

/** One authored opaque JSON field. */
export interface AuthoredJSONField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** JSON field type. */
  readonly type: FieldType.JSON,
}

/** One authored entity reference. */
export interface AuthoredReferenceField {
  /** Field name, in camelCase. */
  readonly field: string,
  /** Optional inverse navigation name. */
  readonly inverse?: string,
  /** Referenced entity name. */
  readonly target: string,
  /** Entity reference field type. */
  readonly type: FieldType.Entity,
}

/** One authored reciprocal inverse navigation. */
export interface AuthoredInverseField {
  /** Inverse cardinality. */
  readonly cardinality: Cardinality,
  /** Field name, in camelCase. */
  readonly field: string,
  /** Forward reference field name. */
  readonly inverse: string,
  /** Entity exposing the forward reference. */
  readonly target: string,
  /** Inverse navigation field type. */
  readonly type: FieldType.Inverse,
}

/** Any authored entity field. */
export type AuthoredField =
  | AuthoredArrayField
  | AuthoredIdentityField
  | AuthoredInverseField
  | AuthoredJSONField
  | AuthoredReferenceField
  | AuthoredScalarField

/** One authored entity. */
export interface AuthoredEntity {
  /** Parent entity, when using MTI. */
  readonly extends?: string,
  /** Declared local fields. */
  readonly fields: readonly AuthoredField[],
  /** Exact entity name. */
  readonly name: string,
}

/** One authored relationship endpoint. */
export interface AuthoredRelationshipEndpoint {
  /** Endpoint field name, in camelCase. */
  readonly field: string,
  /** Inverse navigation name on the target. */
  readonly inverse: string,
  /** Referenced entity name. */
  readonly target: string,
}

/** One authored named relationship. */
export interface AuthoredRelationship {
  /** The two relationship endpoints. */
  readonly between: readonly [AuthoredRelationshipEndpoint, AuthoredRelationshipEndpoint],
  /** Relationship-owned fields. */
  readonly fields: readonly (AuthoredArrayField | AuthoredJSONField | AuthoredScalarField)[],
  /** Relationship name. */
  readonly name: string,
}

/** JSON-compatible typed authoring document. */
export interface AuthoredDocument {
  /** Entity declarations. */
  readonly entities: readonly AuthoredEntity[],
  /** Named relationship declarations. */
  readonly relationships?: readonly AuthoredRelationship[],
}

/**
 * Validate a typed JSON-compatible authoring document.
 *
 * The typed form is serialized and passed through the exact canonical
 * `EntityDefinitions.load` validator; it is not a second model registry.
 * @param document - Typed authoring document or canonical JSON text.
 * @returns Validated canonical definitions.
 * @throws {Error} When the document is invalid.
 */
export function defineEntities(document: AuthoredDocument | string): EntityDefinitions {
  return EntityDefinitions.load(
    typeof document === 'string' ? document : JSON.stringify(document),
  )
}

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
    lines.push(`  readonly entity: '${entity.name}'`)
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
    const properties = {
      entity: { const: entity.name, type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      ...Object.fromEntries(entity.effectiveFields
        .filter(field => field.name !== 'id' && field.name !== 'name' && field.name !== 'entity')
        .map(field => [field.name, schemaForField(field)])),
    }
    schemas[entity.name] = {
      create: { properties, required: ['entity', 'name'], type: 'object' },
      output: { properties, required: ['id', 'entity', 'name'], type: 'object' },
      update: { properties, type: 'object' },
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
        lines.push(`    ${fieldType(field)} ${field.name}`)
      }
      lines.push('  }')
    }
    for (const relationship of definitions.relationships) {
      lines.push(`  ${relationship.name} {`)
      for (const field of relationship.fields) lines.push(`    ${fieldType(field)} ${field.name}`)
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
 * @returns JSON Schema fragment.
 */
function schemaForField(field: EffectiveFieldDefinition): Record<string, unknown> {
  if (field.type === FieldType.Entity) return { type: ['string', 'null'] }
  if (field.type === FieldType.Array) return {
    items: schemaForScalar(field.items.type),
    type: 'array',
  }
  if (field.type === FieldType.JSON) return {}
  return schemaForScalar(field.type)
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
