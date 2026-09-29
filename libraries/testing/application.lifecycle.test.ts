import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Lifecycle proof for `useApplication`.
 *
 * These run real child `bun test` processes so the process-wide registry is
 * exercised across Bun's per-file module registry, and the preload teardown runs
 * exactly once at the end of a real run. A tiny fixture server records its boot
 * and stop (with pid) to a log file, so the assertions count real boots and
 * stops rather than inspecting module state.
 */

const repoRoot = join(import.meta.dir, '..', '..')
const preload = join(repoRoot, 'libraries', 'testing', 'bun.ts')
const application = join(repoRoot, 'libraries', 'testing', 'application.ts')

/** The fixture server: appends `boot`/`stop` (with pid) to `$ACTIVITY_LOG`. */
const APP_SOURCE = [
  "import { appendFileSync } from 'node:fs'",
  '',
  'const log = process.env.ACTIVITY_LOG',
  'const record = (event: string): void => {',
  '  if (log) appendFileSync(log, `${event} ${process.pid}\\n`)',
  '}',
  '',
  "record('boot')",
  'Bun.serve({',
  "  hostname: process.env.HOST ?? '127.0.0.1',",
  '  port: Number(process.env.PORT ?? 0),',
  "  routes: { '/health': () => new Response('ok') },",
  '})',
  '',
  'const stop = (): void => {',
  "  record('stop')",
  '  process.exit(0)',
  '}',
  '',
  "process.on('SIGTERM', stop)",
  "process.on('SIGINT', stop)",
].join('\n')

/**
 * A test file that imports the fixture helpers.
 * @param body - The test declarations to include.
 * @returns The test module source.
 */
const suite = (body: string): string => [
  "import { expect, test } from 'bun:test'",
  `import { stopApplications, useApplication } from '${application}'`,
  '',
  body,
].join('\n')

/**
 * A minimal test file that boots the same app.
 * @param name - The test name.
 * @returns The test module source.
 */
const bootSuite = (name: string): string => suite(
  `test('${name}', async () => {\n  await useApplication({ entry: './app.ts' })\n})`,
)

/**
 * Source for an eager preload that boots the fixture app before the suite.
 * @param entry - The fixture entry to boot.
 * @param timeoutMs - Readiness timeout, used when a boot failure is expected.
 * @returns The preload module source.
 */
function eagerPreload(entry: string, timeoutMs?: number): string {
  const options = timeoutMs === undefined
    ? `{ entry: '${entry}' }`
    : `{ entry: '${entry}', timeoutMs: ${timeoutMs} }`
  return [
    `import { useApplication } from '${application}'`,
    `await useApplication(${options})`,
    '',
  ].join('\n')
}

/** One fixture directory and its activity log. */
interface Fixture {
  /** Absolute path to the activity log the fixture app appends to. */
  activity: string,
  /** Absolute fixture directory. */
  dir: string,
}

/** Counted boot/stop events from a fixture run. */
interface Activity {
  /** How many times the fixture server booted. */
  boot: number,
  /** The pid the fixture server booted with, when it booted once. */
  pid: number | null,
  /** How many times the fixture server stopped. */
  stops: number,
}

/** Fixture directories created by this test, removed after the run. */
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { force: true, recursive: true })
})

/**
 * Write a fixture directory.
 * @param files - Extra files keyed by relative path.
 * @param preloads - Preload entries for the fixture's `bunfig.toml`.
 * @returns The fixture directory and activity log path.
 */
function fixture(files: Record<string, string>, preloads: string[] = [preload]): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'basis-application-'))
  created.push(dir)
  const activity = join(dir, 'activity.log')
  const resolved = preloads.map(entry => (entry.startsWith('/') ? entry : join(dir, entry)))
  writeFileSync(join(dir, 'bunfig.toml'), `[test]\npreload = [${resolved.map(entry => `"${entry}"`).join(', ')}]\n`)
  writeFileSync(join(dir, 'app.ts'), APP_SOURCE)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return { activity, dir }
}

/**
 * Read the fixture activity log.
 * @param path - The activity log path.
 * @returns The counted boot/stop events.
 */
function readActivity(path: string): Activity {
  if (!existsSync(path)) return { boot: 0, pid: null, stops: 0 }

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const bootPids = lines.filter(line => line.startsWith('boot')).map(line => Number(line.split(' ')[1]))
  return {
    boot: bootPids.length,
    pid: bootPids.length === 1 ? bootPids[0] ?? null : null,
    stops: lines.filter(line => line.startsWith('stop')).length,
  }
}

/**
 * Poll a predicate until it holds.
 * @param predicate - The condition to wait for.
 * @param timeoutMs - Maximum wait. Defaults to 15000.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(50)
  }
  throw new Error('timed out waiting for the fixture')
}

/**
 * Whether a pid is still running.
 * @param pid - The process id to probe.
 * @returns True when the process exists.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The outcome of one child `bun test` run. */
interface RunResult {
  /** The child's activity log. */
  activity: Activity,
  /** The child's exit code. */
  code: number,
  /** The child's combined output. */
  output: string,
}

/**
 * Run `bun test` in a fixture directory, optionally interrupting it once the
 * fixture server has booted.
 * @param target - The fixture to run.
 * @param args - Extra `bun test` arguments (for example a single file).
 * @param signal - A signal to send once the fixture server has booted.
 * @returns The exit code, activity, and output.
 */
async function run(target: Fixture, args: string[] = [], signal?: NodeJS.Signals): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, 'test', ...args], {
    cwd: target.dir,
    env: { ...process.env, ACTIVITY_LOG: target.activity },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()

  if (signal) {
    await waitFor(() => readActivity(target.activity).boot > 0)
    proc.kill(signal)
  }

  const code = await proc.exited
  return {
    activity: readActivity(target.activity),
    code,
    output: `${await stdout}\n${await stderr}`,
  }
}

describe('useApplication lifecycle', () => {
  test('boots once and stops once across several files sharing an entry', async () => {
    const target = fixture({
      'a.test.ts': bootSuite('a'),
      'b.test.ts': bootSuite('b'),
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('allows two genuinely different entries to boot separately', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('distinct', async () => {\n" +
        '  const [first, second] = await Promise.all([\n' +
        "    useApplication({ entry: './app.ts' }),\n" +
        "    useApplication({ entry: './app2.ts' }),\n" +
        '  ])\n' +
        '  expect(first.url).not.toBe(second.url)\n' +
        '})',
      ),
      'app2.ts': APP_SOURCE,
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(2)
    expect(activity.stops).toBe(2)
  }, 30_000)

  test('shares one boot across concurrent callers', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('concurrent', async () => {\n" +
        '  const [first, second] = await Promise.all([\n' +
        "    useApplication({ entry: './app.ts' }),\n" +
        "    useApplication({ entry: './app.ts' }),\n" +
        '  ])\n' +
        '  expect(first).toBe(second)\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('tears down exactly once after a failing assertion', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('fails', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        '  expect(1).toBe(2)\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).not.toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('tears down exactly once after a thrown error', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('throws', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        "  throw new Error('boom')\n" +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).not.toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('boots once and tears down once for a filtered single-file run', async () => {
    const target = fixture({
      'a.test.ts': bootSuite('a'),
      'b.test.ts': bootSuite('b'),
    })
    const { activity, code } = await run(target, ['a.test.ts'])
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('tears down exactly once and leaves nothing alive on SIGINT', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('waits', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        '  await Bun.sleep(10_000)\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target, [], 'SIGINT')
    expect(code).not.toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
    expect(activity.pid).not.toBeNull()
    if (activity.pid !== null) expect(isAlive(activity.pid)).toBe(false)
  }, 30_000)

  test('tears down exactly once and leaves nothing alive on SIGTERM', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('waits', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        '  await Bun.sleep(10_000)\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target, [], 'SIGTERM')
    expect(code).not.toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
    expect(activity.pid).not.toBeNull()
    if (activity.pid !== null) expect(isAlive(activity.pid)).toBe(false)
  }, 30_000)

  test('tears down at most once when stop is called repeatedly', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('idempotent', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        '  await Promise.all([stopApplications(), stopApplications()])\n' +
        '  await stopApplications()\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('boots eagerly from a preload and reuses that boot lazily', async () => {
    const eager = 'eager-preload.ts'
    const target = fixture(
      {
        'a.test.ts': suite(
          "test('reuses the eager boot', async () => {\n" +
          "  const app = await useApplication({ entry: './app.ts' })\n" +
          "  expect(app.url).toContain('http://')\n" +
          '})',
        ),
        'eager-preload.ts': eagerPreload('./app.ts'),
      },
      [preload, eager],
    )
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('fails the run at startup when an eager preload cannot boot', async () => {
    const eager = 'eager-preload.ts'
    const target = fixture(
      {
        'a.test.ts': suite(
          "test('does not run', () => {\n" +
          "  expect('the suite should never run').toBe('because the eager boot failed')\n" +
          '})',
        ),
        'eager-preload.ts': eagerPreload('./missing.ts', 2_000),
      },
      [preload, eager],
    )
    const { activity, code, output } = await run(target)
    expect(code).not.toBe(0)
    expect(activity.boot).toBe(0)
    expect(output).not.toContain('the suite should never run')
  }, 30_000)

  test('treats equivalent cwd/entry spellings as one application', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('spellings', async () => {\n" +
        '  const [relative, dotted, absolute] = await Promise.all([\n' +
        "    useApplication({ entry: './app.ts' }),\n" +
        "    useApplication({ cwd: '.', entry: 'app.ts' }),\n" +
        '    useApplication({ cwd: process.cwd(), entry: `${process.cwd()}/app.ts` }),\n' +
        '  ])\n' +
        '  expect(relative).toBe(dotted)\n' +
        '  expect(relative).toBe(absolute)\n' +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)

  test('rejects useApplication after teardown instead of leaking a server', async () => {
    const target = fixture({
      'a.test.ts': suite(
        "test('post-stop', async () => {\n" +
        "  await useApplication({ entry: './app.ts' })\n" +
        '  await stopApplications()\n' +
        "  await expect(useApplication({ entry: './app.ts' })).rejects.toThrow('stopped')\n" +
        '})',
      ),
    })
    const { activity, code } = await run(target)
    expect(code).toBe(0)
    expect(activity.boot).toBe(1)
    expect(activity.stops).toBe(1)
  }, 30_000)
})
