import { expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { containers, useDatabaseFixture } from '../testing/DatabaseFixture'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'

/*
 * Cross-file identity proof, second half. The proof file and activity log are
 * produced by DatabaseInstanceA.e2e.ts inside the same ordinary suite.
 */

/** The run-scoped proof handoff path. */
const proofPath = Bun.env.BASIS_DATABASE_SHARED_PROOF ??
  join(tmpdir(), 'basis-database-shared-proof.json')
/** The run-scoped fixture activity log. */
const activityPath = Bun.env.BASIS_DATABASE_ACTIVITY_LOG ??
  join(tmpdir(), 'basis-database-shared-activity.log')

/** The proof recorded by the first file. */
interface TransferProof {
  /** Child process that attached to the shared fixture. */
  readonly childPid?: number,
  /** Shared managed container id. */
  readonly container: string,
  /** Shared installation identity. */
  readonly install: string,
  /** Note id written and rolled back by the first file. */
  readonly noteId: string,
  /** PostgreSQL postmaster start time shared by both files. */
  readonly started: string,
}

test('observes the same instance and no cross-file write', async () => {
  process.env.BASIS_DATABASE_ACTIVITY_LOG = activityPath
  if (!existsSync(proofPath)) throw new Error('the first identity file did not record its proof')
  const proof = JSON.parse(readFileSync(proofPath, 'utf8')) as TransferProof
  const fixture = await useDatabaseFixture('instance-b')
  const [identity] = await fixture.server.db.sql<{ started: string }[]>`
    SELECT pg_postmaster_start_time()::text AS started
  `
  expect(identity?.started).toBe(proof.started)
  expect(fixture.install).toBe(proof.install)
  expect(containers(fixture.install)).toEqual([proof.container])

  const rows = await withIsolatedDatabase('instance-b-read', async database => (
    await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Note"
      WHERE "id" = ${proof.noteId}
    `
  ))
  expect(rows).toEqual([{ count: 0 }])

  const lines = readFileSync(activityPath, 'utf8').split('\n').filter(Boolean)
  const lifecycle = lines.filter(line => (
    line.startsWith('start ')
    || line.startsWith('attach ')
    || line.startsWith('canonical ')
  ))
  const installs = new Set(lifecycle.map(line => line.split(' ')[2]))
  expect(installs).toEqual(new Set([proof.install]))
  expect(lines.filter(line => line.startsWith('start ')).length).toBeLessThanOrEqual(1)
  expect(lines.filter(line => line.startsWith('canonical ')).length).toBeLessThanOrEqual(1)
  if (proof.childPid) {
    expect(lines.some(line => (
      line.startsWith('attach ') && line.endsWith(` ${proof.childPid}`)
    ))).toBe(true)
  }
  expect(containers(proof.install)).toHaveLength(1)
  rmSync(proofPath, { force: true })
}, 120_000)
