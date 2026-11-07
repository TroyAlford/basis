import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac } from 'node:crypto'

/** One request-scoped canonical actor, with anonymous represented explicitly. */
export interface RequestActor {
  /** The canonical User id, or null for an anonymous request. */
  readonly id: string | null,
}

/** The lifetime of one server-signed actor token. */
const TOKEN_LIFETIME_SECONDS = 60 * 60
/** The signing key version carried by actor and identity proofs. */
export const SIGNING_KEY_VERSION = 'v1'

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

/**
 * Sign one canonical actor id for the current PostgreSQL transaction and domain.
 * @param actorId - Canonical User id.
 * @param secret - Server-owned signing secret.
 * @param transactionId - PostgreSQL transaction id from `txid_current()`.
 * @param domain - Current PostgreSQL database/application domain.
 * @returns The transaction-bound actor token.
 */
export function signActor(
  actorId: string,
  secret: string,
  transactionId: string,
  domain: string,
): string {
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
  const payload = [
    Buffer.from(actorId, 'utf8').toString('hex'),
    transactionId,
    domain,
    SIGNING_KEY_VERSION,
    String(expiry),
  ].join(':')
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}:${signature}`
}

/**
 * Sign one verified provider subject for database identity enrollment.
 * @param provider - Provider slug.
 * @param subject - Stable provider subject.
 * @param secret - Server-owned signing secret.
 * @param domain - Current PostgreSQL database/application domain.
 * @returns The short-lived identity proof.
 */
export function signIdentity(
  provider: string,
  subject: string,
  secret: string,
  domain: string,
): string {
  const expiry = Math.floor(Date.now() / 1000) + 300
  const payload = [
    Buffer.from(provider, 'utf8').toString('hex'),
    Buffer.from(subject, 'utf8').toString('hex'),
    domain,
    SIGNING_KEY_VERSION,
    String(expiry),
  ].join(':')
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}:${signature}`
}
