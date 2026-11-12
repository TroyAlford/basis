import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { containers, useDatabaseFixture } from '../testing/DatabaseFixture'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'

/*
 * Cross-file identity proof, first half. This file runs before
 * DatabaseInstanceB.e2e.ts in the ordinary shared-database suite.
 */

/** The run-scoped proof handoff path. */
const proofPath = Bun.env.BASIS_DATABASE_SHARED_PROOF ??
  join(tmpdir(), 'basis-database-shared-proof.json')
/** The run-scoped fixture activity log. */
const activityPath = Bun.env.BASIS_DATABASE_ACTIVITY_LOG ??
  join(tmpdir(), 'basis-database-shared-activity.log')
/** The repository root used as the child process working directory. */
const repoRoot = join(import.meta.dir, '..', '..', '..')
/** The fixture module loaded by the child process. */
const fixtureModule = join(import.meta.dir, '..', 'testing', 'DatabaseFixture.ts')

test('records the shared instance identity and rolls back its write', async () => {
  process.env.BASIS_DATABASE_ACTIVITY_LOG = activityPath
  const fixture = await useDatabaseFixture('instance-a')
  const [identity] = await fixture.server.db.sql<{ started: string }[]>`
    SELECT pg_postmaster_start_time()::text AS started
  `
  const container = containers(fixture.install)[0]
  if (!container) throw new Error('the shared fixture did not report a container')
  const noteId = randomUUID()

  await withIsolatedDatabase('instance-a-write', async database => {
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${noteId}, ${'shared-a'}, ${'Note'})
    `
    await database.sql`
      INSERT INTO "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
      VALUES (${noteId}, ${'shared-a'}, TRUE, 1.5, '2026-01-02', now())
    `
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Note"
      WHERE "id" = ${noteId}
    `).toEqual([{ count: 1 }])
  })

  const code = `
    const { useDatabaseFixture } = await import(${JSON.stringify(pathToFileURL(fixtureModule).href)})
    const fixture = await useDatabaseFixture('subprocess-attach')
    console.log(JSON.stringify({ install: fixture.install, pid: process.pid }))
    await fixture.server.shutdown()
  `
  const child = Bun.spawn([process.execPath, '-e', code], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BASIS_DATABASE_ACTIVITY_LOG: activityPath,
      BASIS_DATABASE_FIXTURE_EPHEMERAL: '0',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const exit = await child.exited
  if (exit !== 0) throw new Error(`fixture subprocess failed (${exit}): ${stderr}`)
  const childResult = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
    install?: string,
    pid?: number,
  }
  expect(childResult.install).toBe(fixture.install)

  writeFileSync(proofPath, `${JSON.stringify({
    childPid: childResult.pid,
    container,
    install: fixture.install,
    noteId,
    started: identity?.started,
  })}\n`)
  expect(JSON.parse(readFileSync(proofPath, 'utf8'))).toMatchObject({
    container,
    install: fixture.install,
  })
}, 120_000)
