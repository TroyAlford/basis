/** A run-scoped cleanup callback registered by a test helper. */
export type RunCleanup = () => Promise<void> | void

/** The process-wide run cleanup registry. */
interface RunCleanupRegistry {
  /** Registered callbacks keyed by registration order. */
  readonly callbacks: Map<number, RunCleanup>,
  /** The next callback identifier. */
  nextId: number,
  /** Whether run cleanup has started. */
  stopped: boolean,
}

/** The `globalThis` property that holds the run cleanup registry. */
const REGISTRY_PROPERTY = '__basisTestingRunCleanup'

/**
 * The process-wide registry, created on first use.
 * @returns The shared registry.
 */
function registry(): RunCleanupRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[REGISTRY_PROPERTY] as RunCleanupRegistry | undefined
  if (existing) return existing

  const created: RunCleanupRegistry = { callbacks: new Map(), nextId: 0, stopped: false }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Register cleanup for an in-process resource owned by the test run.
 *
 * The testing preload runs registered callbacks exactly once after the suite,
 * including after failures, and on `SIGINT`/`SIGTERM`. Use this for a resource
 * that cannot use the child-process `useApplication` lifecycle but still needs
 * process-wide teardown.
 * @param cleanup - Idempotent cleanup callback.
 * @returns A function that unregisters the callback.
 * @throws {Error} When the run has already started cleanup.
 */
export function registerRunCleanup(cleanup: RunCleanup): () => void {
  const scope = registry()
  if (scope.stopped) throw new Error('Run cleanup has already started')
  const id = scope.nextId
  scope.nextId += 1
  scope.callbacks.set(id, cleanup)
  return () => {
    scope.callbacks.delete(id)
  }
}

/**
 * Run every registered callback exactly once. Idempotent.
 * @returns A promise that resolves after every callback settles.
 */
export async function cleanupRun(): Promise<void> {
  const scope = registry()
  if (scope.stopped) return
  scope.stopped = true
  const callbacks = [...scope.callbacks.values()]
  scope.callbacks.clear()
  await Promise.allSettled(callbacks.map(cleanup => Promise.resolve().then(cleanup)))
}
