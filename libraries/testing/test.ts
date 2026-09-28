import { describe as bunDescribe, it as bunIt, test as bunTest } from 'bun:test'
import { callerFile } from './caller'

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

/** Number of wrapped tests declared per test file. */
const declared = new Map<string, number>()
/** Number of wrapped test bodies that actually ran per test file. */
const executed = new Map<string, number>()

/**
 * Test files whose entire declared suite executed.
 *
 * `toMatchScreenshot`'s cleanup only prunes snapshots for these, so a file
 * filtered with `-t` — or one containing a skipped test — is never mistaken for
 * a file whose snapshots are stale.
 * @returns The fully executed test file paths.
 */
export function fullyRunFiles(): string[] {
  const files: string[] = []
  for (const [file, total] of declared) {
    if (total > 0 && executed.get(file) === total) files.push(file)
  }
  return files
}

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
 * @param file - The test file that declared the test, when known.
 * @returns The wrapped body, or the original value when it is not a function.
 */
const track = (name: string, body: unknown, file: string | null): unknown => {
  if (typeof body !== 'function') return body
  const fullName = [...describeStack, name].filter(Boolean).join(' ')
  return function tracked(this: unknown, ...args: unknown[]): unknown {
    if (file) executed.set(file, (executed.get(file) ?? 0) + 1)
    const previous = currentName
    currentName = fullName
    const restore = () => {
      currentName = previous
    }

    let result: unknown
    try {
      result = (body as (...inner: unknown[]) => unknown).apply(this, args)
    } catch (error) {
      restore()
      throw error
    }

    /*
     * An async body records its name until the returned promise settles; a
     * synchronous `finally` would clear it before the awaited assertions run.
     */
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).finally(restore)
    }

    restore()
    return result
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
    const file = callerFile()
    if (typeof body === 'function' && file) declared.set(file, (declared.get(file) ?? 0) + 1)
    return Reflect.apply(fn as (...inner: unknown[]) => unknown, thisArg, [
      name,
      track(String(name), body, file),
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
