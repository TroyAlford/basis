import type { ScalarFieldType } from './EntityDefinitions'

/**
 * Resolve the canonical PostgreSQL scalar type for one authored field kind.
 *
 * This is the single PostgreSQL type boundary shared by physical DDL and
 * bound-query operands. TypeScript and JSON Schema formats remain separate
 * consumer concerns.
 * @param type - Scalar field kind.
 * @returns PostgreSQL type name.
 * @throws {Error} When the field kind is not a PostgreSQL scalar.
 */
export function postgresScalarType(type: ScalarFieldType): string {
  switch (type) {
    case 'Boolean': return 'boolean'
    case 'Date': return 'date'
    case 'ID': return 'text'
    case 'Number': return 'double precision'
    case 'String': return 'text'
    case 'Timestamp': return 'timestamptz'
    default: throw new Error(`Unsupported PostgreSQL scalar type: ${String(type)}`)
  }
}
