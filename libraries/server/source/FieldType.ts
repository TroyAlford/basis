/**
 * Canonical field types.
 *
 * `Entity` is the singular reference kind. `Enum` is a named Graph enum value.
 * `Array` holds scalar values in a native PostgreSQL array. `JSON` is an opaque
 * structured value. Entity collections are navigations derived from inverse
 * references or named top-level relationships, never authored as fields.
 */
export enum FieldType {
  /** Native scalar array. */
  Array = 'Array',
  /** Boolean value. */
  Boolean = 'Boolean',
  /** Calendar date without a time of day. */
  Date = 'Date',
  /** Singular reference to another entity. */
  Entity = 'Entity',
  /** Named Graph enum value. */
  Enum = 'Enum',
  /** Universal text identity. */
  ID = 'ID',
  /** Navigation-only reciprocal field. */
  Inverse = 'Inverse',
  /** Opaque JSON value. */
  JSON = 'JSON',
  /** Numeric value, including integers and floating point numbers. */
  Number = 'Number',
  /** Text value. */
  String = 'String',
  /** Instant in time. */
  Timestamp = 'Timestamp',
}
