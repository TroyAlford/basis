import type { EffectiveFieldDefinition, EntityDefinition, EnumDefinition, FieldDefinition, Graph, ScalarFieldDefinition } from 'basis/server'
import { FieldType } from 'basis/server'
import type { EmittedFile } from '../emitter'
import { emitter } from '../emitter'

/**
 * Generate TypeScript entity types.
 * @param graph - Canonical application Graph.
 * @returns Deterministic TypeScript source.
 */
export function generateTypes(graph: Graph): string {
  const definitions = graph.definitions
  const entities = [...definitions.entities].sort((left, right) => left.name.localeCompare(right.name))
  const enums = [...definitions.enums].sort((left, right) => left.name.localeCompare(right.name))
  const enumMembers = entities
    .map(entity => `${entity.name} = '${entity.name}',`)
    .join('\n')
  const blocks: string[] = [
    `/** Generated from the canonical Basis entity definitions. Do not edit by hand. */

export enum $BasisEntities {
${indent(enumMembers)}
}

export interface Reference {
  readonly entity: $BasisEntities,
  readonly id: string,
  readonly name: string,
}

export interface Entity extends Reference {
  readonly lastUpdatedAt: string | null,
  readonly lastUpdatedBy: Reference | null,
}`,
  ]
  for (const enumeration of enums) blocks.push(enumBlock(enumeration))
  for (const entity of entities) blocks.push(entityBlock(entity, definitions))
  return `${blocks.join('\n\n')}\n`
}

/**
 * Render one named Graph enum.
 * @param enumeration - Canonical enum definition.
 * @returns Generated TypeScript block.
 */
function enumBlock(enumeration: EnumDefinition): string {
  const members = enumeration.values.map(value => (
    `/** ${jsdoc(value.description)} */\n` +
    `${value.member} = '${value.value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}',`
  )).join('\n')
  return `export enum ${enumeration.name} {\n${indent(members)}\n}`
}

/**
 * Make one description safe inside a single-line JSDoc comment.
 * @param description - Authored description.
 * @returns Escaped description.
 */
function jsdoc(description: string): string {
  return description.replaceAll('*/', '*\\/').replaceAll(/\s+/gu, ' ').trim()
}

/**
 * Render one entity interface.
 * @param entity - Entity definition.
 * @param definitions - Canonical definitions.
 * @returns Generated TypeScript block.
 */
function entityBlock(entity: EntityDefinition, definitions: Graph['definitions']): string {
  const parent = entity.parent === 'Entity' ? 'Entity' : entity.parent
  const members = [
    { line: `readonly entity: ${discriminatorType(entity, definitions)},`, name: 'entity' },
    ...entity.fields
      .filter(field => field.name !== 'id' && field.type !== FieldType.Inverse)
      .map(field => ({
        line: `readonly ${field.name}: ${fieldType(field)},`,
        name: field.name,
      })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  return `export interface ${entity.name} extends ${parent} {
${indent(members.map(member => member.line).join('\n'))}
}`
}

/**
 * Indent one generated block by one level.
 * @param value - Unindented generated lines.
 * @returns The same lines indented two spaces.
 */
function indent(value: string): string {
  return value.split('\n').map(line => `  ${line}`).join('\n')
}

/**
 * Render one entity's discriminator union.
 * @param entity - Entity definition.
 * @param definitions - Canonical definitions.
 * @returns TypeScript discriminator type.
 */
function discriminatorType(
  entity: EntityDefinition,
  definitions: Graph['definitions'],
): string {
  const leaves = entity.abstract ? definitions.concreteDescendants(entity.name) : [entity]
  return leaves.map(leaf => `$BasisEntities.${leaf.name}`).join(' | ') || '$BasisEntities'
}

/**
 * Render one field's hydrated TypeScript type.
 * @param field - Effective or authored field.
 * @returns TypeScript type expression.
 */
function fieldType(field: EffectiveFieldDefinition | FieldDefinition): string {
  if (field.type === FieldType.Entity) {
    return field.nullable === false ? 'Reference' : 'Reference | null'
  }
  if (field.type === FieldType.Array) {
    const array = `readonly ${scalarType(field.items.type)}[]`
    return field.nullable === true ? `${array} | null` : array
  }
  if (field.type === FieldType.JSON) return 'unknown'
  if (field.type === FieldType.Inverse) return 'unknown'
  if (field.type === FieldType.Enum) {
    return field.nullable === true ? `${field.enum} | null` : field.enum
  }
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
export default TypeScriptEmitter
