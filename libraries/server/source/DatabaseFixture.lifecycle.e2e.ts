import { run as runCommand } from 'basis/configuration'
import { tempDirectory, waitFor } from 'basis/testing'
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Lifecycle proof for the run-scoped in-process database fixture.
 *
 * These run real child `bun test` processes so the process-wide fixture is
 * exercised the way consumers meet it: several test files, failure cleanup, and
 * signal teardown. The fixture appends actual start/stop and acquisition events
 * to `$BASIS_DATABASE_ACTIVITY_LOG`, so assertions observe real service
 * lifecycle rather than module-local counters.
 */

const repoRoot = join(import.meta.dir, '..', '..', '..')
const preload = join(repoRoot, 'libraries', 'testing', 'bun.ts')
const fixtureModule = join(repoRoot, 'libraries', 'server', 'testing', 'DatabaseFixture.ts')

/** Fixture directories created by this test, removed after the run. */
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { force: true, recursive: true })
})

/** One child fixture directory. */
interface Fixture {
  /** Absolute path to the activity log. */
  readonly activity: string,
  /** Absolute fixture directory. */
  readonly dir: string,
}

/**
 * Write a child test fixture with the testing preload.
 * @param files - Test module sources keyed by file name.
 * @returns The fixture directory and activity log path.
 */
function fixture(files: Record<string, string>): Fixture {
  const dir = tempDirectory('basis-database-fixture-lifecycle-')
  created.push(dir)
  symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
  writeFileSync(
    join(dir, 'bunfig.toml'),
    `[test]\npreload = [${JSON.stringify(preload)}]\n`,
  )
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return { activity: join(dir, 'activity.log'), dir }
}

/**
 * A child suite that acquires the shared fixture once.
 * @param label - Acquisition label recorded by the fixture.
 * @param body - Additional test body after acquisition.
 * @returns The test module source.
 */
function suite(label: string, body = ''): string {
  return [
    "import { expect, test } from 'bun:test'",
    `import { useDatabaseFixture } from ${JSON.stringify(fixtureModule)}`,
    '',
    `test(${JSON.stringify(label)}, async () => {`,
    `  const { server } = await useDatabaseFixture(${JSON.stringify(label)})`,
    '  expect(server.db.closed).toBe(false)',
    body,
    '}, 120_000)',
  ].join('\n')
}

/** Observed fixture lifecycle events. */
interface Activity {
  /** Caller labels that acquired the shared fixture. */
  readonly acquires: readonly string[],
  /** Run-cleanup callback invocations. */
  readonly cleanups: readonly string[],
  /** Actual service start events. */
  readonly starts: readonly string[],
  /** Actual service stop events. */
  readonly stops: readonly string[],
}

/**
 * Read the fixture activity log.
 * @param path - Activity log path.
 * @returns The observed events.
 */
function activity(path: string): Activity {
  if (!existsSync(path)) return { acquires: [], cleanups: [], starts: [], stops: [] }
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
  return {
    acquires: lines.filter(line => line.startsWith('acquire ')).map(line => line.slice(8)),
    cleanups: lines.filter(line => line === 'cleanup'),
    starts: lines.filter(line => line.startsWith('start ')),
    stops: lines.filter(line => line.startsWith('stop ')),
  }
}

/**
 * Whether a process id is still alive.
 * @param pid - Process id to check.
 * @returns `true` when the process exists.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Assert that the fixture installation owns no Docker resources.
 * @param events - Observed fixture activity.
 */
function expectRemoved(events: Activity): void {
  const start = events.starts[0]
  if (!start) throw new Error('fixture never started')
  const install = start.split(' ')[2]
  const containers = runCommand`docker ps -aq --filter ${`label=basis.install=${install}`}`
  const volumes = runCommand`docker volume ls -q --filter ${`label=basis.install=${install}`}`
  expect(containers.exitCode).toBe(0)
  expect(containers.lines).toEqual([])
  expect(volumes.exitCode).toBe(0)
  expect(volumes.lines).toEqual([])
}

/**
 * Run `bun test` in a fixture directory.
 * @param target - The fixture to run.
 * @param args - Extra test file arguments.
 * @param signal - Optional signal to send after the fixture starts.
 * @param readyTimeoutMs - How long to wait for a signal target to start.
 * @returns The exit code and observed activity.
 */
async function run(
  target: Fixture,
  args: string[] = [],
  signal?: NodeJS.Signals,
  readyTimeoutMs = 60_000,
): Promise<{ activity: Activity, code: number, output: string }> {
  const proc = Bun.spawn([process.execPath, 'test', ...args], {
    cwd: target.dir,
    env: { ...process.env, BASIS_DATABASE_ACTIVITY_LOG: target.activity },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()

  let code: number | null = null
  try {
    if (signal) {
      await waitFor(() => activity(target.activity).starts.length > 0, { timeout: readyTimeoutMs })
      proc.kill(signal)
    }
    code = await proc.exited
  } finally {
    if (code === null) {
      proc.kill('SIGTERM')
      const exited = await Promise.race([
        proc.exited.then(() => true),
        Bun.sleep(2_000).then(() => false),
      ])
      if (!exited) {
        proc.kill('SIGKILL')
        await proc.exited
      }
    }
  }

  if (code === null) throw new Error('child test process did not exit')
  return {
    activity: activity(target.activity),
    code,
    output: `${await stdout}\n${await stderr}`,
  }
}

describe('database fixture lifecycle', () => {
  test('starts once across independent test files and stops once', async () => {
    const target = fixture({
      'a.test.ts': suite('a'),
      'b.test.ts': suite('b'),
    })
    const result = await run(target)

    expect(result.code).toBe(0)
    expect([...result.activity.acquires].sort()).toEqual(['a', 'b'])
    expect(result.activity.cleanups).toHaveLength(1)
    expect(result.activity.starts).toHaveLength(1)
    expect(result.activity.stops).toHaveLength(1)
    expect(result.activity.starts[0]?.split(' ')[1]).toBe(result.activity.stops[0]?.split(' ')[1])
    expectRemoved(result.activity)
  }, 120_000)

  test('tears down after a failing test', async () => {
    const target = fixture({
      'a.test.ts': suite('failure', '  expect(1).toBe(2)'),
    })
    const result = await run(target)

    expect(result.code).not.toBe(0)
    expect(result.activity.cleanups).toHaveLength(1)
    expect(result.activity.starts).toHaveLength(1)
    expect(result.activity.stops).toHaveLength(1)
    expectRemoved(result.activity)
  }, 120_000)

  test('reaps a child that never starts the fixture', async () => {
    const target = fixture({
      'a.test.ts': [
        "import { test } from 'bun:test'",
        "import { writeFileSync } from 'node:fs'",
        '',
        "test('stall', async () => {",
        "  writeFileSync('child.pid', String(process.pid))",
        '  await Bun.sleep(10_000)',
        '}, 20_000)',
      ].join('\n'),
    })
    const pidFile = join(target.dir, 'child.pid')

    await expect(run(target, [], 'SIGTERM', 5_000)).rejects.toThrow('waitFor')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(false)
  }, 30_000)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`tears down on ${signal}`, async () => {
      const target = fixture({
        'a.test.ts': suite('signal', '  await Bun.sleep(10_000)'),
      })
      const result = await run(target, [], signal)

      expect(result.activity.cleanups).toHaveLength(1)
      expect(result.activity.starts).toHaveLength(1)
      expect(result.activity.stops).toHaveLength(1)
      expectRemoved(result.activity)
    }, 120_000)
  }
})
