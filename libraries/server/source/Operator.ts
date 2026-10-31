/* eslint-disable @typescript-eslint/no-namespace -- Operator is the required public namespace.
 */
/**
 * The complete operator vocabulary accepted by canonical entity queries.
 *
 * Values are the stable JSON/string-language wire names. Code must use the
 * enum members, not the raw wire strings.
 */
export namespace Operator {
  /** Field comparison operators. */
  export enum Comparison {
    /** Equal. */
    Equal = '$eq',
    /** Greater than. */
    GreaterThan = '$gt',
    /** Greater than or equal. */
    GreaterThanOrEqual = '$gte',
    /** Less than. */
    LessThan = '$lt',
    /** Less than or equal. */
    LessThanOrEqual = '$lte',
  }

  /** Logical expression operators. */
  export enum Logical {
    /** All operands must match. */
    And = '$and',
  }
}
