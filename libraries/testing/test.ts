import { describe as bunDescribe, it as bunIt, test as bunTest } from 'bun:test'

/*
 * Bun does not expose the current test name to custom matchers (there is no
 * `expect.getState()`), so `toMatchScreenshot` cannot key snapshots the way
 * `toMatchSnapshot` does. This module wraps `test`, `it`, and `describe` to
 * record the name while a body runs and to compose `describe` ancestors.
 *
 * A recursive Proxy preserves Bun's full modifier surface (`.skip`, `.only`,
 * `.each`, `.if`, ...) without re-declaring it. The `as unknown as` casts are
 * required because a Proxy cannot preserve the nominal function type.
 */

let currentName: string | null = null
const describeStack: string[] = []
const counts = new Map<string, number>()

/**
 * The full name of the test currently executing.
 *
 * `toMatchScreenshot` uses this to mirror Bun's snapshot keys (`<test name> <n>`
 * or `<test name>: <hint> <n>`). It is `null` outside a test registered through
 * this module's wrapped `test`/`it`.
 * @returns The current test name, or null.
 */
export function currentTestName(): string | null {
  return currentName
}

/**
 * Reserve the next index for a snapshot key, mirroring Bun's per-key counter.
 * @param key - The snapshot key (test name plus optional hint).
 * @returns The next index, starting at 1.
 */
export function nextSnapshotIndex(key: string): number {
  const next = (counts.get(key) ?? 0) + 1
  counts.set(key, next)
  return next
}

/**
 * Wrap a test body so it records the current test name while it runs.
 * @param name - The test name.
 * @param body - The test body.
 * @returns The wrapped body, or the original value when it is not a function.
 */
const track = (name: string, body: unknown): unknown => {
  if (typeof body !== 'function') return body
  const fullName = [...describeStack, name].filter(Boolean).join(' ')
  return function tracked(this: unknown, ...args: unknown[]): unknown {
    const previous = currentName
    currentName = fullName
    try {
      return (body as (...inner: unknown[]) => unknown).apply(this, args)
    } finally {
      currentName = previous
    }
  }
}

/**
 * Recursively proxy a Bun test function so every callback is tracked.
 * @param target - The test function or one of its modifiers.
 * @returns The proxied function.
 */
const wrapTest = (target: unknown): unknown => new Proxy(target as object, {
  apply(fn, thisArg, args) {
    const [name, body, ...rest] = args as [string, unknown, ...unknown[]]
    return Reflect.apply(fn as (...inner: unknown[]) => unknown, thisArg, [
      name,
      track(String(name), body),
      ...rest,
    ])
  },
  get(fn, property) {
    const value = Reflect.get(fn as object, property)
    return typeof value === 'function' ? wrapTest(value) : value
  },
}) as unknown

/**
 * Recursively proxy a Bun describe function so nested test names compose.
 * @param target - The describe function or one of its modifiers.
 * @returns The proxied function.
 */
const wrapDescribe = (target: unknown): unknown => new Proxy(target as object, {
  apply(fn, thisArg, args) {
    const [name, body, ...rest] = args as [string, unknown, ...unknown[]]
    if (typeof body !== 'function') return Reflect.apply(fn as (...inner: unknown[]) => unknown, thisArg, args)
    const scoped = () => {
      describeStack.push(String(name))
      try {
        return (body as () => unknown)()
      } finally {
        describeStack.pop()
      }
    }
    return Reflect.apply(fn as (...inner: unknown[]) => unknown, thisArg, [name, scoped, ...rest])
  },
  get(fn, property) {
    const value = Reflect.get(fn as object, property)
    return typeof value === 'function' ? wrapDescribe(value) : value
  },
}) as unknown

/** `bun:test`'s `test`, tracking the current test name for snapshots. */
export const test = wrapTest(bunTest) as unknown as typeof bunTest

/** Alias of {@link test}. */
export const it = wrapTest(bunIt) as unknown as typeof bunIt

/** `bun:test`'s `describe`, composing nested names for snapshots. */
export const describe = wrapDescribe(bunDescribe) as unknown as typeof bunDescribe
