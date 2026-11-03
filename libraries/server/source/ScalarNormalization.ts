import type { ScalarFieldDefinition } from './EntityDefinitions'
import { FieldType, isCanonicalSnowflake, isCanonicalUUID } from './EntityDefinitions'

/** A normalized non-null scalar value ready for SQL or a write. */
export type NormalizedScalar = string | number | boolean | Date

/** Signed 64-bit Snowflake bounds accepted from bigint inputs. */
const SNOWFLAKE_MIN = -9223372036854775808n
const SNOWFLAKE_MAX = 9223372036854775807n

/**
 * Normalize one non-null scalar value against its canonical field definition.
 *
 * `undefined` means the value is invalid for the field. Null policy remains
 * owned by each caller.
 * @param field - Canonical scalar field.
 * @param value - Raw non-null value.
 * @returns The normalized value, or `undefined` when invalid.
 */
export function normalizeScalar(field: ScalarFieldDefinition, value: unknown): NormalizedScalar | undefined {
  switch (field.type) {
    case FieldType.Boolean:
      return typeof value === 'boolean' ? value : undefined
    case FieldType.Date:
      return typeof value === 'string' && value.length > 0 ? value : undefined
    case FieldType.Number:
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    case FieldType.ID: {
      const canonicalUUID = typeof value === 'string' && isCanonicalUUID(value)
      const canonicalSnowflake = (typeof value === 'string' && isCanonicalSnowflake(value))
        || (typeof value === 'bigint' && value >= SNOWFLAKE_MIN && value <= SNOWFLAKE_MAX)
      if (field.format === 'UUID') return canonicalUUID ? value : undefined
      if (field.format === 'Snowflake') {
        if (typeof value === 'bigint') return canonicalSnowflake ? value.toString() : undefined
        return typeof value === 'string' && isCanonicalSnowflake(value) ? value : undefined
      }
      if (canonicalUUID) return value
      if (typeof value === 'bigint') return canonicalSnowflake ? value.toString() : undefined
      return typeof value === 'string' && isCanonicalSnowflake(value) ? value : undefined
    }
    case FieldType.String:
      return typeof value === 'string' ? value : undefined
    case FieldType.Timestamp:
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value
      return typeof value === 'string' && value.length > 0 ? value : undefined
    default:
      return undefined
  }
}
