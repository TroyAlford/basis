import type { EffectiveFieldDefinition, EntityDefinitions, FieldDefinition, ScalarFieldDefinition } from 'basis/server'
import { FieldType } from 'basis/server'

/** Supported ERD projections. */
export type ErdMode = 'logical' | 'physical'

/**
 * Generate a deterministic Mermaid ERD from the canonical model.
 * @param definitions - Validated canonical definitions.
 * @param mode - Logical entities or physical tables.
 * @returns Mermaid source.
 */
export function generateErd(
  definitions: EntityDefinitions,
  mode: ErdMode = 'logical',
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
