import { expect, test } from 'bun:test'
import type { ReleaseHealth } from './release'
import { startReleaseMonitor } from './release'

interface Scheduled {
  callback: () => void,
  delay: number,
}

/**
 * Build a deterministic monitor clock and health source.
 * @param responses - Health responses or errors to return in order.
 * @returns The monitor disposer, scheduled timers, and reload counter.
 */
function harness(responses: (ReleaseHealth | Error)[]) {
  const scheduled: Scheduled[] = []
  let reloads = 0
  const monitor = startReleaseMonitor({
    clear: () => undefined,
    health: async () => {
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next ?? { status: 'ok', version: 'A' }
    },
    loadedVersion: 'A',
    maxRetryMs: 5_000,
    pollMs: 1_000,
    reload: () => { reloads += 1 },
    retryBaseMs: 250,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay })
      return scheduled.length
    },
  })
  return { monitor, reloads: () => reloads, scheduled }
}

/**
 * Run the next scheduled monitor check.
 * @param scheduled - Scheduled checks.
 */
async function tick(scheduled: Scheduled[]): Promise<void> {
  const next = scheduled.shift()
  if (!next) throw new Error('missing scheduled check')
  next.callback()
  await Promise.resolve()
  await Promise.resolve()
}

test('keeps polling unchanged versions without reloading', async () => {
  const testHarness = harness([
    { status: 'ok', version: 'A' },
    { status: 'ok', version: 'A' },
  ])
  expect(testHarness.scheduled[0]?.delay).toBe(1_000)
  await tick(testHarness.scheduled)
  expect(testHarness.reloads()).toBe(0)
  expect(testHarness.scheduled[0]?.delay).toBe(1_000)
  await tick(testHarness.scheduled)
  expect(testHarness.reloads()).toBe(0)
  testHarness.monitor()
})

test('retries failed and non-ready checks with bounded backoff', async () => {
  const testHarness = harness([
    new Error('offline'),
    { status: 'starting' },
    { status: 'ok', version: 'A' },
  ])
  await tick(testHarness.scheduled)
  expect(testHarness.scheduled[0]?.delay).toBe(250)
  await tick(testHarness.scheduled)
  expect(testHarness.scheduled[0]?.delay).toBe(500)
  await tick(testHarness.scheduled)
  expect(testHarness.reloads()).toBe(0)
  expect(testHarness.scheduled[0]?.delay).toBe(1_000)
  testHarness.monitor()
})

test('reloads exactly once when a ready server reports a new version', async () => {
  const testHarness = harness([
    { status: 'ok', version: 'B' },
  ])
  await tick(testHarness.scheduled)
  expect(testHarness.reloads()).toBe(1)
  expect(testHarness.scheduled).toHaveLength(0)
  testHarness.monitor()
})

test('stops scheduling after disposal', async () => {
  const testHarness = harness([{ status: 'ok', version: 'A' }])
  testHarness.monitor()
  await tick(testHarness.scheduled)
  expect(testHarness.scheduled).toHaveLength(0)
})
