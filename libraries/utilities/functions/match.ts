/** Symbol used as a placeholder in pattern matching */
export const _ = Symbol('placeholder')

/** Symbol used to represent the initial state before any matches */
const INITIAL = Symbol('INITIAL')

/** Type for matching array-like objects with optional length and indexed values */
type ArrayLikeMatcher<U> = (
  & Partial<Record<`${number}`, U | typeof _>>
  & { length?: number | typeof _ }
)

/** Type for matching numbers, either exact values or within a range */
type NumberMatcher = number | { max?: number, min?: number }

/** Type for matching strings, either exact values or regex patterns */
type StringMatcher = string | RegExp

/** Type for matching arrays, allowing placeholders for individual elements */
type ArrayMatcher<T> = T extends (infer U)[]
  ? ((U | typeof _)[] | ArrayLikeMatcher<U>)
  : never

/** Type for matching objects, allowing placeholders for individual properties */
type ObjectMatcher<T> = T extends object
  ? { [K in keyof T]?: T[K] | typeof _ }
  : never

/** Union type of all possible matcher types that can be used in pattern matching */
type Matcher<T> =
  | ArrayMatcher<T>
  | NumberMatcher
  | ObjectMatcher<T>
  | StringMatcher
  | ((value: T) => boolean)

/** Utility type to extract known types, filtering out unknown */
type Known<T> = T extends unknown ? (unknown extends T ? never : T) : T

/** Function type for handling successful matches with access to matched value and placeholders */
type ThenFn<T, R> = (value: T, placeholders: unknown[]) => R

/** Function type for handling fallback cases with access to the original value */
type ElseFn<T, R> = (value: T) => R

/**
 * Creates a new pattern matching chain for a value.
 * @param value The value to match against patterns
 * @returns A new Match instance
 * @example
 * match(value)
 *   .when(5).then('five')
 *   .when(10).then('ten')
 *   .else('unknown')
 */
class Match<Value, Return = unknown, Narrowed = unknown> {
  private matched = false
  private result: unknown | typeof INITIAL = INITIAL
  private placeholders: unknown[] = []

  constructor(private value: Value) { }

  /**
   * Starts a new matching condition. If the previous conditions haven't matched,
   * evaluates the value against the provided matcher.
   * @param matcher The pattern to match against
   * @returns The Match instance for chaining
   * @example
   * match(value)
   *   .when(5).then('five')  // Matches exact value
   *   .when({ min: 0, max: 10 }).then('within range')  // Matches range
   *   .when(/^\d+$/).then('is numeric')  // Matches regex
   */
  when<M = Value>(matcher: M | Matcher<M>) {
    this.placeholders.length = 0
    if (this.result === INITIAL && !this.matched) this.matched = this.evaluate(matcher)
    return this as Pick<Match<Value, Return, M>, 'and' | 'or' | 'then'>
  }

  /**
   * Adds an additional condition that must also match for the current pattern.
   * Only evaluated if the previous matcher(s) succeeded.
   * @param matcher Additional pattern that must also match
   * @returns The Match instance for chaining
   * @example
   * match(value)
   *   .when(num => num > 0)
   *   .and(num => num < 10)
   *   .then('between 0 and 10')
   */
  and<M = Narrowed>(matcher: M | Matcher<M>) {
    if (this.result === INITIAL && this.matched) this.matched = this.evaluate(matcher)
    return this as Pick<Match<Value, Return, M | Narrowed>, 'and' | 'then'>
  }

  /**
   * Provides an alternative pattern to match if the previous pattern(s) failed.
   * Only evaluated if the previous matcher(s) failed.
   * @param matcher Alternative pattern to try matching
   * @returns The Match instance for chaining
   * @example
   * match(value)
   *   .when(5)
   *   .or(10)
   *   .then('five or ten')
   */
  or<M = Narrowed>(matcher: M | Matcher<M>) {
    if (this.result === INITIAL && !this.matched) this.matched = this.evaluate(matcher)
    if (!this.matched) this.placeholders.length = 0
    return this as Pick<Match<Value, Return, M | Narrowed>, 'or' | 'then'>
  }

  /**
   * Specifies the result to return if the current pattern matches.
   * @param predicate Value or function to evaluate for the result
   * @returns The Match instance for chaining
   * @example
   * match(value)
   *   .when(5).then('five')  // Static value
   *   .when(n => n > 0).then(n => `positive: ${n}`)  // Function
   */
  then<Then = Narrowed>(predicate: Then | ThenFn<Narrowed, Then>) {
    if (this.result === INITIAL && this.matched) {
      this.result = typeof predicate === 'function'
        ? (predicate as ThenFn<Value, Then>)(this.value, this.placeholders)
        : predicate
    }
    return this as Pick<Match<Value, Known<Return | Then>, unknown>, 'else' | 'when'>
  }

  /**
   * Provides a default result if no patterns matched.
   * This is the terminal operation that returns the final result.
   * @param predicate Default value or function to evaluate
   * @returns The final result of the pattern matching
   * @example
   * match(value)
   *   .when(5).then('five')
   *   .else('unknown')  // Static fallback
   *   .else(v => `unmatched: ${v}`)  // Function fallback
   */
  else<Else>(predicate: Else | ElseFn<Value, Return | Else>): Return | Else {
    if (this.matched) return this.result as Return
    return typeof predicate === 'function'
      ? (predicate as ElseFn<Value, Else>)(this.value)
      : predicate
  }

  private evaluate<M>(matcher: Matcher<M>): boolean {
    const queue: [unknown, unknown][] = [[matcher, this.value]]

    while (queue.length) {
      const [matchOn, value] = queue.shift()

      if (matchOn === value) continue

      if (matchOn === _) {
        this.placeholders.push(value)
        continue
      }

      if (typeof matchOn === 'function') {
        if (!matchOn(value)) return false
        continue
      }

      if (Array.isArray(matchOn) && Array.isArray(value)) {
        if (matchOn.length > value.length) return false
        for (let i = 0; i < matchOn.length; i++) {
          queue.push([matchOn[i], value[i]])
        }
        continue
      }

      // Handling array-like object matching
      if (this.#isArrayLikeObject(matchOn) && Array.isArray(value)) {
        const { length, ...indices } = matchOn

        // Check if the length matches, or if length is a placeholder
        if (length !== _ && typeof length !== 'number') return false
        if (length !== value.length) return false

        // Iterate over the indices and match them against the value array
        for (const key in indices) {
          const index = parseInt(key, 10)

          // Ensure the key is a valid array index
          if (isNaN(index) || index < 0 || index >= value.length) return false

          // Push the corresponding pairs into the queue for further evaluation
          queue.push([indices[key], value[index]])
        }

        continue
      }

      if (typeof value === 'string' && matchOn instanceof RegExp) {
        const matches = value.match(matchOn)
        if (matches) {
          this.placeholders = Object.values(matches.groups || {})
          continue
        }
        return false
      }

      if (typeof value === 'number' && this.#isNumberMatcher(matchOn)) {
        if (this.#isObject<{ max?: number, min?: number }>(matchOn)) {
          const { max, min } = matchOn
          if (typeof min === 'number' && value < min) return false
          if (typeof max === 'number' && value > max) return false
          continue
        }
      }

      if (
        this.#isObject<Record<string, unknown>>(matchOn)
        && this.#isObject<Record<string, unknown>>(value)
      ) {
        for (const key in matchOn) {
          if (
            // If matcher declares a key undefined, it must not exist in the value
            (matchOn[key] === undefined && value[key] !== undefined)
            // Otherwise, it must exist in the value
            || !(key in value)
          ) return false

          queue.unshift([matchOn[key], value[key]])
        }
        continue
      }

      if (matchOn !== value) return false
    }

    return true
  }

  #isArrayLikeObject(value: unknown): value is ArrayLikeMatcher<unknown> {
    return (
      this.#isObject<Record<string, unknown>>(value)
      && typeof (value as { length: unknown }).length === 'number'
    )
  }
  #isNumberMatcher(matcher: unknown): matcher is NumberMatcher {
    if (typeof matcher === 'number') return true
    return typeof matcher === 'object' && ('max' in matcher || 'min' in matcher)
  }
  #isObject<O>(o: unknown): o is O {
    return typeof o === 'object' && o !== null
  }
}

/**
 * Creates a new pattern matching chain for a value.
 * Supports matching against exact values, ranges, regular expressions,
 * array patterns, object patterns, and custom predicates.
 * @param value The value to match against patterns
 * @returns A new Match instance
 * @example
 * match(5)
 *   .when(5).then('five')
 *   .when({ min: 0, max: 10 }).then('small number')
 *   .else('something else')
 */
export const match = <Value, Return>(value: Value) => new Match<Value, Return, unknown>(value)
