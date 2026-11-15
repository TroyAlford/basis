import type { EffectiveFieldDefinition, FieldDefinition, Graph, ScalarFieldDefinition } from 'basis/server'
import { FieldType } from 'basis/server'
import type { EmittedFile } from '../emitter'
import { emitter } from '../emitter'

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
 * Generate the TypeScript emitter file set.
 * @param graph - Canonical application Graph.
 * @returns One generated TypeScript file.
 */
export function typescriptOutput(graph: Graph): readonly EmittedFile[] {
  return [{ content: generateTypes(graph), name: 'index' }]
}

/** Independently owned TypeScript entity emitter. */
export const TypeScriptEmitter = emitter(
  { extension: 'ts', folder: 'typescript' },
  typescriptOutput,
)

// Emitter modules are discovered and invoked by their default export.
// eslint-disable-next-line @basis/no-default-export
export default TypeScriptEmitter

/**
 * Render one field's TypeScript type.
 * @param field - Effective field.
 * @returns TypeScript type expression.
 */
function fieldType(field: EffectiveFieldDefinition | FieldDefinition): string {
  if (field.type === FieldType.Entity) {
    return field.nullable === false ? `${field.target}Ref` : `${field.target}Ref | null`
  }
  if (field.type === FieldType.Array) {
    const array = `readonly ${scalarType(field.items.type)}[]`
    return field.nullable === true ? `${array} | null` : array
  }
  if (field.type === FieldType.JSON) return 'unknown'
  if (field.type === FieldType.Inverse) return 'unknown'
  const scalar = scalarType(field.type)
  return field.nullable === true ? `${scalar} | null` : scalar
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
