import type { EntityDefinitions } from '../source/EntityDefinitions'
import type { DatabaseContext } from './DatabaseFixture'
import { withDatabase } from './DatabaseFixture'

/**
 * The internal fixture context used by Basis's database engine and schema
 * proofs. It is the same context as `withDatabase`, viewed through the owner
 * role.
 */
export type LifecycleDatabase = DatabaseContext

/** Options for one lifecycle-backed owner transaction. */
export interface LifecycleDatabaseOptions {
  /** Entity definitions to prepare and query; defaults to the fixture's shared model. */
  readonly entities?: EntityDefinitions,
  /** Allocate a disposable unique schema for the proof. */
  readonly fresh?: boolean,
}

/**
 * Run an internal owner-role database proof.
 * @param label - Fixture acquisition label.
 * @param callback - Work using the owner-role transaction.
 * @param options - Entity definitions and disposable-schema selection.
 * @returns The callback result.
 */
export async function withLifecycleDatabase<T>(
  label: string,
  callback: (database: LifecycleDatabase) => Promise<T>,
  options: LifecycleDatabaseOptions = {},
): Promise<T> {
  return withDatabase(label, null, callback, { owner: true, ...options })
}
