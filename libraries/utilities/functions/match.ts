export const _ = Symbol('placeholder')
const INITIAL = Symbol('INITIAL')

type NumberMatcher = number | { max?: number, min?: number }
type StringMatcher = string | RegExp
type ArrayMatcher<T> = T extends Array<infer U>
	? Array<U | typeof _>
	: never
type ObjectMatcher<T> = T extends object
	? { [K in keyof T]?: T[K] | typeof _ }
	: never

type Matcher<T> =
  | ArrayMatcher<T>
  | NumberMatcher
  | ObjectMatcher<T>
  | StringMatcher
  | ((value: T) => boolean)

type Known<T> = T extends unknown ? (unknown extends T ? never : T) : T;
type ThenFn<T, R> = (value: T, placeholders: unknown[]) => R;
type ElseFn<T, R> = (value: T) => R;

class Match<Value, Return = unknown, Narrowed = unknown> {
	private matched = false
	private result: unknown | typeof INITIAL = INITIAL
	private placeholders: unknown[] = []

	constructor(private value: Value) {}

	when<M = Value>(matcher: M | Matcher<M>) {
		if (this.result === INITIAL && !this.matched) this.matched = this.evaluate(matcher)
		return this as Pick<Match<Value, Return, M>, 'and' | 'or' | 'then'>
	}

	and<M = Narrowed>(matcher: M | Matcher<M>) {
		if (this.result === INITIAL && this.matched) this.matched = this.evaluate(matcher)
		return this as Pick<Match<Value, Return, M | Narrowed>, 'and' | 'then'>
	}

	or<M = Narrowed>(matcher: M | Matcher<M>) {
		if (this.result === INITIAL && !this.matched) this.matched = this.evaluate(matcher)
		return this as Pick<Match<Value, Return, M | Narrowed>, 'or' | 'then'>
	}

	then<Then = Narrowed>(predicate: Then | ThenFn<Narrowed, Then>) {
		if (this.result === INITIAL && this.matched) {
			this.result = typeof predicate === 'function'
				? (predicate as ThenFn<Value, Then>)(this.value, this.placeholders)
				: predicate
		}
		return this as Pick<Match<Value, Known<Return | Then>, unknown>, 'else' | 'when'>
	}

	else<Else>(predicate: Else | ElseFn<Value, Return | Else>): Return | Else {
		if (this.matched) return this.result as Return
		return typeof predicate === 'function'
			? (predicate as ElseFn<Value, Else>)(this.value)
			: predicate
	}

	/* eslint-disable @typescript-eslint/no-explicit-any */
	private evaluate<M>(matcher: Matcher<M>): boolean {
		const queue: Array<[unknown, any]> = [[matcher, this.value]]
		this.placeholders.length = 0

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
						(matchOn[key] === undefined && value[key] !== undefined) ||
						// Otherwise, it must exist in the value
            !(key in value)
					) return false

					queue.unshift([matchOn[key], value[key]])
				}
				continue
			}

			if (matchOn !== value) return false
		}

		return true
	}
	/* eslint-enable @typescript-eslint/no-explicit-any */

	#isNumberMatcher(matcher: unknown): matcher is NumberMatcher {
		if (typeof matcher === 'number') return true
		return typeof matcher === 'object' && ('max' in matcher || 'min' in matcher)
	}
	#isObject<O>(o: unknown): o is O {
		return typeof o === 'object' && o !== null
	}
}

// Helper function to initiate the match
export const match = <Value, Return>(value: Value) => (
	new Match<Value, Return, unknown>(value)
)
