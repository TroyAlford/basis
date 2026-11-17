import type { Graph } from '../server/source/Graph'
import type { DatabaseContext, DatabaseTestOptions } from '../server/testing/DatabaseFixture'
import { withDatabase as withInternalDatabase } from '../server/testing/DatabaseFixture'

/** The public database context. Privileged owner switching is internal-only. */
export type WithDatabaseContext = Omit<DatabaseContext, 'asOwner'>

/** Public options for a consumer database test. */
export interface WithDatabaseOptions {
  /** Consumer Graph to install with the shared restricted role. */
  readonly graph?: Graph,
  /** Seed or prepare data as the trusted owner before entering the app role. */
  readonly setup?: (database: WithDatabaseContext) => Promise<void>,
}

/** Public database test callback. */
type WithDatabaseCallback<T> = (database: WithDatabaseContext) => Promise<T>

/**
 * Build the public view of one fixture context.
 * @param context - Internal fixture context, including privileged capabilities.
 * @returns Only the consumer-safe members.
 */
function publicContext(context: DatabaseContext): WithDatabaseContext {
  return {
    captureError: context.captureError,
    create: context.create,
    delete: context.delete,
    edit: context.edit,
    entities: context.entities,
    query: context.query,
    schema: context.schema,
    sql: context.sql,
    tx: context.tx,
    upsert: context.upsert,
    use: context.use,
  }
}

/**
 * Narrow one public options object to the consumer surface.
 * @param options - Public options, possibly carrying internal fields through a cast.
 * @returns Only the public graph and setup fields.
 */
function publicOptions(options: WithDatabaseOptions | undefined): DatabaseTestOptions {
  return {
    ...(options?.graph === undefined ? {} : { graph: options.graph }),
    ...(options?.setup === undefined ? {} : {
      setup: async (database: DatabaseContext) => options.setup?.(publicContext(database)),
    }),
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
      database => actorOrCallback(publicContext(database)),
      publicOptions(callbackOrOptions as WithDatabaseOptions | undefined),
    )
  }
  return withInternalDatabase(
    label,
    actorOrCallback,
    database => (callbackOrOptions as WithDatabaseCallback<T>)(publicContext(database)),
    publicOptions(maybeOptions),
  )
}
