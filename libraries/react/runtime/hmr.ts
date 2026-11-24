/**
 * Production-safe component HMR runtime.
 *
 * Bun's development server injects React Fast Refresh whenever it sees JSX.
 * React Fast Refresh cannot run against the production React build, so the
 * production HMR plugin pre-transforms JSX and registers top-level classes here
 * instead. The registry keeps the first class for each stable id and copies
 * updated members onto it, preserving the component type — and therefore the
 * mounted component instances — across a module replacement.
 */

/** A constructable component class. */
type ComponentClass = new (...args: never[]) => object

/** Function properties that describe the constructor rather than the class. */
const STATIC_SKIP: ReadonlySet<PropertyKey> = new Set(['length', 'name', 'prototype'])

/** The stable class for each registered component id. */
const classes = new Map<string, ComponentClass>()

/** The own prototype keys written by the previous registration of each id. */
const prototypeKeys = new Map<string, ReadonlySet<PropertyKey>>()

/** The own static keys written by the previous registration of each id. */
const staticKeys = new Map<string, ReadonlySet<PropertyKey>>()

/** Component ids whose class declares runtime-private members. */
const unstableClasses = new Set<string>()

/** Re-renders the mounted application root, when one has attached. */
let rerender: (() => void) | null = null

/** Whether a render has already been queued for this microtask turn. */
let scheduled = false

/** Monotonic HMR generation consumed by mounted class components. */
let generation = 0

/**
 * Read the current HMR generation.
 *
 * A mounted Component compares this value in `shouldComponentUpdate`, so an
 * in-place class update renders through nested components even when their props
 * and state are deeply equal.
 * @returns The current generation.
 */
export function hmrGeneration(): number {
  return generation
}

/**
 * Attach the application root renderer that receives component updates.
 *
 * The generated hydration entry calls this once after creating or hydrating
 * the React root. Replacing the callback makes a full reload (or a second root)
 * safe.
 * @param render - Re-renders the mounted application root.
 */
export function attachRoot(render: () => void): void {
  rerender = render
}

/**
 * Register one class component under a stable id and return the class the
 * module should export.
 *
 * The first registration stores the class. A later registration copies the new
 * prototype methods, accessors, and static members onto the stored class, so
 * React sees the same component type and preserves mounted instances and state.
 * A changed base class cannot be merged safely; it replaces the stored class and
 * lets React remount the subtree. Runtime-private members (`#field`) carry a
 * per-class brand that cannot be transferred to existing instances, so classes
 * that declare them are also replaced; React remounts that subtree.
 * @param id - Stable component id, normally the source path and class name.
 * @param next - The class just evaluated by the module.
 * @param unstable - Whether the class declares runtime-private members.
 * @returns The class the module should export.
 */
export function register<T extends ComponentClass>(id: string, next: T, unstable = false): T {
  const previous = classes.get(id)

  if (!previous) {
    classes.set(id, next)
    prototypeKeys.set(id, ownKeys(next.prototype, new Set(['constructor'])))
    staticKeys.set(id, ownKeys(next, STATIC_SKIP))
    if (unstable) unstableClasses.add(id)
    return next
  }

  if (
    unstable
    || unstableClasses.has(id)
    || Object.getPrototypeOf(previous.prototype) !== Object.getPrototypeOf(next.prototype)
  ) {
    classes.set(id, next)
    prototypeKeys.set(id, ownKeys(next.prototype, new Set(['constructor'])))
    staticKeys.set(id, ownKeys(next, STATIC_SKIP))
    if (unstable) unstableClasses.add(id)
    else unstableClasses.delete(id)
    schedule()
    return next
  }

  prototypeKeys.set(
    id,
    replaceKeys(previous.prototype, next.prototype, prototypeKeys.get(id), new Set(['constructor'])),
  )
  staticKeys.set(id, replaceKeys(previous, next, staticKeys.get(id), STATIC_SKIP))
  schedule()
  return previous as T
}

/**
 * Queue one application root render for the current microtask turn.
 */
function schedule(): void {
  if (scheduled) return

  scheduled = true
  generation += 1
  queueMicrotask(() => {
    scheduled = false
    rerender?.()
  })
}

/**
 * The own keys of an object, excluding the supplied keys.
 * @param value - The object to inspect.
 * @param skip - Keys that must not be copied.
 * @returns The remaining own keys.
 */
function ownKeys(value: object, skip: ReadonlySet<PropertyKey>): ReadonlySet<PropertyKey> {
  return new Set(Reflect.ownKeys(value).filter(key => !skip.has(key)))
}

/**
 * Replace the own members of one object with the members of another.
 *
 * Keys written by the previous registration and absent from the new class are
 * removed; every current key is copied with its full property descriptor so
 * methods, getters, setters, and statics all update in place.
 * @param target - The stable object to mutate.
 * @param source - The newly evaluated object.
 * @param previous - The keys written by the previous registration.
 * @param skip - Keys that must not be copied or removed.
 * @returns The keys written by this registration.
 */
function replaceKeys(
  target: object,
  source: object,
  previous: ReadonlySet<PropertyKey> | undefined,
  skip: ReadonlySet<PropertyKey>,
): ReadonlySet<PropertyKey> {
  const next = ownKeys(source, skip)
  const nextKeys = new Set(next)

  if (previous) {
    for (const key of previous) {
      if (!nextKeys.has(key) && !skip.has(key)) Reflect.deleteProperty(target, key)
    }
  }

  for (const key of next) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor) Object.defineProperty(target, key, descriptor)
  }

  return next
}
