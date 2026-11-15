import type { EffectiveFieldDefinition, EntityDefinition, FieldDefinition, Graph, ScalarFieldDefinition } from 'basis/server'
import { FieldType } from 'basis/server'
import type { EmittedFile } from '../emitter'
import { emitter } from '../emitter'

/**
 * Generate TypeScript entity, mutation, and reference types.
 * @param graph - Canonical application Graph.
 * @returns Deterministic TypeScript source.
 */
export function generateTypes(graph: Graph): string {
  const definitions = graph.definitions
  const entities = [...definitions.entities].sort((left, right) => left.name.localeCompare(right.name))
  const enumMembers = entities
    .map(entity => `  ${entity.name} = '${entity.name}',`)
    .join('\n')
  const blocks: string[] = [
    `/** Generated from the canonical Basis entity definitions. Do not edit by hand. */

export enum Entities {
${enumMembers}
}

export interface Entity {
  readonly entity: Entities,
  readonly id: string,
  readonly lastUpdatedAt: string | null,
  readonly lastUpdatedBy: UserRef | null,
  readonly name: string,
}

export type EntityRef = Pick<Entity, 'id' | 'name' | 'entity'>`,
  ]
  for (const entity of entities) blocks.push(entityBlock(entity, definitions))
  blocks.push(mapBlock('CreateMap', entities.map(entity => (
    `  readonly ${entity.name}: ${entity.name}Create`
  ))))
  blocks.push(mapBlock('EntityMap', entities.map(entity => (
    `  readonly ${entity.name}: ${entity.name}`
  ))))
  blocks.push(mapBlock('UpdateMap', entities.map(entity => (
    `  readonly ${entity.name}: ${entity.name}Update`
  ))))
  const references = entities
    .filter(entity => entity.effectiveFields.some(field => field.type === FieldType.Entity))
    .map(entity => {
      const fields = entity.effectiveFields
        .filter(field => field.type === FieldType.Entity)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(field => `    readonly ${field.name}: '${field.target}',`)
        .join('\n')
      return `  readonly ${entity.name}: {\n${fields}\n  },`
    })
  blocks.push(`export interface ReferenceMap {\n${references.join('\n')}\n}`)
  return `${blocks.join('\n\n')}\n`
}

/**
 * Render one entity interface and its mutation inputs.
 * @param entity - Entity definition.
 * @param definitions - Canonical definitions.
 * @returns Generated TypeScript block.
 */
function entityBlock(entity: EntityDefinition, definitions: Graph['definitions']): string {
  const parent = entity.parent === 'Entity' ? 'Entity' : entity.parent
  const members = [
    { line: `  readonly entity: ${discriminatorType(entity, definitions)},`, name: 'entity' },
    ...entity.fields
      .filter(field => field.name !== 'id' && field.type !== FieldType.Inverse)
      .map(field => ({
        line: `  readonly ${field.name}: ${fieldType(field)},`,
        name: field.name,
      })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  const fields = members.map(member => member.line).join('\n')
  const create = createBlock(entity)
  return `export interface ${entity.name} extends ${parent} {
${fields}
}

export type ${entity.name}Ref = Pick<${entity.name}, 'id' | 'name' | 'entity'>

${create}`
}

/**
 * Render one entity's create input type.
 * @param entity - Entity definition.
 * @returns Generated create input block.
 */
function createBlock(entity: EntityDefinition): string {
  const id = entity.idFormat === 'Snowflake'
    ? { line: '  id: string,', name: 'id' }
    : { line: '  id?: string,', name: 'id' }
  const fields = entity.effectiveFields
    .filter(field => !['entity', 'id', 'lastUpdatedAt', 'lastUpdatedBy'].includes(field.name))
    .map(field => {
      const optional = field.default !== undefined || (
        field.type === FieldType.Entity ? field.nullable !== false : field.nullable === true
      )
      return {
        line: `  ${field.name}${optional ? '?' : ''}: ${mutationType(field)},`,
        name: field.name,
      }
    })
  const members = [id, ...fields].sort((left, right) => left.name.localeCompare(right.name))
  return `export interface ${entity.name}Create {
${members.map(member => member.line).join('\n')}
}

export type ${entity.name}Update = Partial<Omit<${entity.name}Create, 'id'>>`
}

/**
 * Render one name-to-type map interface.
 * @param name - Interface name.
 * @param entries - Rendered entries.
 * @returns Generated map block.
 */
function mapBlock(name: string, entries: readonly string[]): string {
  const sorted = [...entries]
    .sort((left, right) => left.localeCompare(right))
    .map(entry => (entry.endsWith(',') ? entry : `${entry},`))
  return `export interface ${name} {\n${sorted.join('\n')}\n}`
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
  return leaves.map(leaf => `Entities.${leaf.name}`).join(' | ') || 'Entities'
}

/**
 * Render one field's hydrated TypeScript type.
 * @param field - Effective or authored field.
 * @returns TypeScript type expression.
 */
function fieldType(field: EffectiveFieldDefinition | FieldDefinition): string {
  if (field.type === FieldType.Entity) {
    const reference = `${field.target}Ref`
    return field.nullable === false ? reference : `${reference} | null`
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
 * Render one field's mutation input type.
 * @param field - Effective field.
 * @returns TypeScript input type expression.
 */
function mutationType(field: EffectiveFieldDefinition): string {
  const nullable = field.type === FieldType.Entity
    ? field.nullable !== false
    : field.nullable === true
  if (field.type === FieldType.Entity) return nullable ? 'string | null' : 'string'
  if (field.type === FieldType.Array) {
    const array = `readonly ${scalarType(field.items.type)}[]`
    return nullable ? `${array} | null` : array
  }
  if (field.type === FieldType.JSON) return nullable ? 'unknown' : 'unknown'
  const scalar = scalarType(field.type)
  return nullable ? `${scalar} | null` : scalar
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
// eslint-disable-next-line @basis/no-default-export
export default TypeScriptEmitter
