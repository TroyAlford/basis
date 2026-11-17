import type { Graph } from '../server/source/Graph'
import type { DatabaseContext } from '../server/testing/DatabaseFixture'
import { withDatabase as withInternalDatabase } from '../server/testing/DatabaseFixture'

/** Public options for a consumer database test. */
export interface WithDatabaseOptions {
  /** Consumer Graph to install with the shared restricted role. */
  readonly graph?: Graph,
  /** Seed or prepare data as the trusted owner before entering the app role. */
  readonly setup?: (database: DatabaseContext) => Promise<void>,
}

/** Public database test callback. */
type WithDatabaseCallback<T> = (database: DatabaseContext) => Promise<T>

/**
 * Narrow one public options object to the consumer surface.
 * @param options - Public options, possibly carrying internal fields through a cast.
 * @returns Only the public graph and setup fields.
 */
function publicOptions(options: WithDatabaseOptions | undefined): WithDatabaseOptions {
  return {
    ...(options?.graph === undefined ? {} : { graph: options.graph }),
    ...(options?.setup === undefined ? {} : { setup: options.setup }),
  }
}

/**
 * Run one consumer database test in an app-role transaction that always rolls back.
 * @param label - Fixture acquisition label.
 * @param callback - Work using the app-role transaction.
 * @param options - Consumer Graph and owner-run setup.
 * @returns The callback result after rollback.
 */
export function withDatabase<T>(
  label: string,
  callback: WithDatabaseCallback<T>,
  options?: WithDatabaseOptions,
): Promise<T>
/**
 * Run one consumer database test as a verified actor.
 * @param label - Fixture acquisition label.
 * @param actor - Verified actor identity, or null for anonymous.
 * @param callback - Work using the app-role transaction.
 * @param options - Consumer Graph and owner-run setup.
 * @returns The callback result after rollback.
 */
export function withDatabase<T>(
  label: string,
  actor: string | null,
  callback: WithDatabaseCallback<T>,
  options?: WithDatabaseOptions,
): Promise<T>
export function withDatabase<T>(
  label: string,
  actorOrCallback: string | null | WithDatabaseCallback<T>,
  callbackOrOptions?: WithDatabaseCallback<T> | WithDatabaseOptions,
  maybeOptions: WithDatabaseOptions = {},
): Promise<T> {
  if (typeof actorOrCallback === 'function') {
    return withInternalDatabase(
      label,
      null,
      actorOrCallback,
      publicOptions(callbackOrOptions as WithDatabaseOptions | undefined),
    )
  }
  return withInternalDatabase(
    label,
    actorOrCallback,
    callbackOrOptions as WithDatabaseCallback<T>,
    publicOptions(maybeOptions),
  )
}
