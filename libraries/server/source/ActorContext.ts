import { AsyncLocalStorage } from 'node:async_hooks'

/** One request-scoped canonical actor, with anonymous represented explicitly. */
export interface RequestActor {
  /** The canonical User id, or null for an anonymous request. */
  readonly id: string | null,
}

const storage = new AsyncLocalStorage<RequestActor>()

/**
 * Run work under one request actor.
 * @param actor - The canonical actor, or null for anonymous.
 * @param callback - Work that may open native transactions.
 * @returns The callback result.
 */
export function runAsActor<T>(actor: RequestActor, callback: () => T): T {
  return storage.run(actor, callback)
}

/**
 * Read the actor for the active request context.
 * @returns The actor, or undefined outside a request.
 */
export function currentActor(): RequestActor | undefined {
  return storage.getStore()
}
