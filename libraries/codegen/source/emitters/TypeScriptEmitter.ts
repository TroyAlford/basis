import type { EffectiveFieldDefinition, EntityDefinition, FieldDefinition, Graph, GraphEnumDefinition, ScalarFieldDefinition } from 'basis/server'
import { enumMemberIdentifier, FieldType } from 'basis/server'
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
  const enumMembers = entities
    .map(entity => `    ${entity.name} = '${entity.name}',`)
    .join('\n')
  const blocks: string[] = [
    '/** Generated from the canonical Basis entity definitions. Do not edit by hand. */',
    ...Object.keys(definitions.enums)
      .sort((left, right) => left.localeCompare(right))
      .map(name => enumBlock(name, definitions.enums[name] as GraphEnumDefinition)),
    `export enum $BasisEntities {
${enumMembers.replaceAll('    ', '  ')}
}

export interface $BasisReference {
  readonly entity: $BasisEntities,
  readonly id: string,
  readonly name: string,
}

export interface $BasisEntity extends $BasisReference {
  readonly lastUpdatedAt: string | null,
  readonly lastUpdatedBy: $BasisReference | null,
}`,
  ]
  for (const entity of entities) blocks.push(entityBlock(entity, definitions))
  return `${blocks.join('\n\n')}\n`
}

/**
 * Render one named Graph enum and its member descriptions.
 * @param name - Enum name.
 * @param definition - Persisted values mapped to descriptions.
 * @returns Generated TypeScript enum block.
 */
function enumBlock(name: string, definition: GraphEnumDefinition): string {
  const members = Object.entries(definition).map(([value, description]) => (
    `${jsdoc(description, '  ')}\n  ${enumMemberIdentifier(value)} = ${quote(value)},`
  ))
  return `export enum ${name} {\n${members.join('\n')}\n}`
}

/**
 * Render one escaped JSDoc block.
 * @param description - End-user description.
 * @param indent - Indentation applied to every line.
 * @returns JSDoc comment text.
 */
function jsdoc(description: string, indent: string): string {
  const safe = description.replaceAll('*/', '*\\/')
  return [
    `${indent}/**`,
    ...safe.split(/\r?\n/u).map(line => `${indent} * ${line}`),
    `${indent} */`,
  ].join('\n')
}

/**
 * Quote one TypeScript string literal.
 * @param value - Persisted value.
 * @returns A single-quoted literal.
 */
function quote(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('\v', '\\v')
    .replaceAll('\0', '\\0')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  return `'${escaped}'`
}

/**
 * Render one entity interface.
 * @param entity - Entity definition.
 * @param definitions - Canonical definitions.
 * @returns Generated TypeScript block.
 */
function entityBlock(entity: EntityDefinition, definitions: Graph['definitions']): string {
  const parent = entity.parent === 'Entity' ? '$BasisEntity' : entity.parent
  const members = [
    { line: `  readonly entity: ${discriminatorType(entity, definitions)},`, name: 'entity' },
    ...entity.fields
      .filter(field => field.name !== 'id' && field.type !== FieldType.Inverse)
      .map(field => ({
        line: `  readonly ${field.name}: ${fieldType(field)},`,
        name: field.name,
      })),
  ].sort((left, right) => left.name.localeCompare(right.name))
  return `export interface ${entity.name} extends ${parent} {
${members.map(member => member.line).join('\n')}
}`
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
    return field.nullable === false ? '$BasisReference' : '$BasisReference | null'
  }
  if (field.type === FieldType.Array) {
    const array = `readonly ${scalarType(field.items.type)}[]`
    return field.nullable === true ? `${array} | null` : array
  }
  if (field.type === FieldType.Enum) {
    return field.nullable === true ? `${field.enum} | null` : field.enum
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
