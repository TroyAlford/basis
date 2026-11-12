import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { withIsolatedDatabase } from '../testing/DatabaseIsolation'

/*
 * Real overlap proof for the ordinary shared-database suite.
 *
 * The barrier only resolves when both transactions are in flight at the same
 * time. A serial runner would time out instead of passing, so this observes
 * actual overlap rather than a Promise.all over sequential work.
 */

test('overlaps two ordinary tests on one service with independent transactions', async () => {
  const ids = [randomUUID(), randomUUID()]
  const started = [0, 0]
  const finished = [0, 0]
  let arrivals = 0
  let release!: () => void
  const both = new Promise<void>(resolve => { release = resolve })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('ordinary database tests did not overlap')),
      15_000,
    )
  })

  const run = (index: number) => withIsolatedDatabase(`overlap-${index}`, async database => {
    started[index] = Date.now()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${ids[index]}, ${`overlap-${index}`}, ${'Note'})
    `
    await database.sql`
      INSERT INTO "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
      VALUES (${ids[index]}, ${`overlap-${index}`}, TRUE, 1.5, '2026-01-02', now())
    `
    arrivals += 1
    if (arrivals === 2) release()
    try {
      await Promise.race([both, timeout])
    } finally {
      if (arrivals === 2) clearTimeout(timer)
    }
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Note"
      WHERE "id" = ${ids[index]}
    `).toEqual([{ count: 1 }])
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Note"
      WHERE "id" = ${ids[1 - index]}
    `).toEqual([{ count: 0 }])
    finished[index] = Date.now()
  })

  await Promise.all([run(0), run(1)])

  expect(arrivals).toBe(2)
  expect(Math.min(finished[0], finished[1])).toBeGreaterThan(Math.max(started[0], started[1]))
}, 120_000)
