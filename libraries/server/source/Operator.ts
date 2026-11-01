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
    /** Inclusive range convenience for a paired comparison. */
    Between = '$between',
    /** Empty string or null convenience for string fields. */
    Empty = '$empty',
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
    /** Not-equal convenience for `Not(Equal)`. */
    NotEqual = '$ne',
  }

  /** Logical expression operators. */
  export enum Logical {
    /** All operands must match. */
    And = '$and',
    /** Negate one operand. */
    Not = '$not',
    /** Any operand must match. */
    Or = '$or',
  }
}
