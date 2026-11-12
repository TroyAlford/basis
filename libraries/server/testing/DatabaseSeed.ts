import type { SQL } from 'bun'
import { SEED_SCHEMA } from '../../../testing/database/seed/image'
import { useDatabaseFixture } from './DatabaseFixture'

/** A connection to the prebuilt PostgreSQL fixture. */
export interface SeedDatabase {
  /** SQL client scoped to the seeded schema. */
  readonly sql: SQL,
}

/**
 * Run one callback against the seeded schema in the ordinary database service.
 *
 * The 500,000-row dataset is baked into the one shared fixture image; this helper
 * reserves a connection, selects that schema, and resets the session before it
 * returns the connection to the pool. It never starts a second container.
 * @param callback - Work performed against the seeded database.
 * @returns The callback result.
 */
export async function withSeedDatabase<T>(
  callback: (database: SeedDatabase) => Promise<T>,
): Promise<T> {
  const fixture = await useDatabaseFixture('database-seed')
  const reserved = await fixture.database.sql.reserve()
  try {
    await reserved.unsafe(`set search_path to "${SEED_SCHEMA}"`).simple()
    return await callback({ sql: reserved as unknown as SQL })
  } finally {
    await reserved.unsafe('RESET search_path').simple()
    reserved.release()
  }
}
