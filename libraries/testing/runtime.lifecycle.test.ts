import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SNAPSHOT_ACTIVITY_LOG, snapshotImage } from './browser'

/*
 * Lifecycle proof for the run-scoped snapshot runtime.
 *
 * These run real child `bun test` processes so the process-wide runtime is
 * exercised the way a consumer meets it: several test files, many captures, and
 * real `app.visit` snapshots in one run. The runtime appends a line per
 * lifecycle event to `$BASIS_SNAPSHOT_ACTIVITY_LOG`, so the assertions count
 * real container starts, browser connections, and teardowns — the contract is
 * exactly one of each per run — rather than inspecting module state.
 */

/** The absolute fixture files the generated suites import. */
const repoRoot = join(import.meta.dir, '..', '..')
const preload = join(repoRoot, 'libraries', 'testing', 'bun.ts')
const testing = join(repoRoot, 'libraries', 'testing', 'index.ts')
const react = join(repoRoot, 'libraries', 'react', 'index.ts')
const applicationEntry = './testing/e2e/index.ts'

/** Number of distinct component snapshots the first suite captures. */
const FIRST_COMPONENTS = 36
/** Number of distinct component snapshots the second suite captures. */
const SECOND_COMPONENTS = 24
/** Number of repeated captures of one component within a single test. */
const REPEATS = 4
/** Application paths the third suite visits; one snapshot each. */
const VISITS = ['/', '/foo/123', '/bar/234']

/** Fixture directories created by this test, removed after the run. */
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { force: true, recursive: true })
})

/**
 * A component suite that captures `count` distinct buttons plus a repeated one.
 * @param label - Distinguishes the suite's snapshot keys.
 * @param count - Number of distinct captures.
 * @returns The test module source.
 */
function componentSuite(label: string, count: number): string {
  return [
    `import { Button } from ${JSON.stringify(react)}`,
    `import { matchScreenshot, test } from ${JSON.stringify(testing)}`,
    '',
    `test(${JSON.stringify(`${label} captures`)}, async () => {`,
    `  for (let index = 0; index < ${count}; index += 1) {`,
    '    await matchScreenshot(<Button>Button {index}</Button>, `base-${index}`)',
    '  }',
    '}, 60_000)',
    '',
    `test(${JSON.stringify(`${label} repeats`)}, async () => {`,
    `  for (let index = 0; index < ${REPEATS}; index += 1) {`,
    '    await matchScreenshot(<Button>Same</Button>, `repeat-${index}`)',
    '  }',
    '}, 60_000)',
  ].join('\n')
}

/**
 * An application suite that boots one run-scoped server and visits several
 * paths, snapshotting a deterministic element from each.
 * @returns The test module source.
 */
function applicationSuite(): string {
  return [
    `import { matchScreenshot, test, useApplication } from ${JSON.stringify(testing)}`,
    '',
    'const app = await useApplication({',
    `  cwd: ${JSON.stringify(repoRoot)},`,
    `  entry: ${JSON.stringify(applicationEntry)},`,
    '  timeoutMs: 120_000,',
    '})',
    '',
    "test('captures application visits', async () => {",
    `  for (const path of ${JSON.stringify(VISITS)}) {`,
    '    await app.visit(path, async page => {',
    "      await page.waitForSelector('[data-testid=\"swatch\"]')",
    "      await matchScreenshot(page.locator('[data-testid=\"swatch\"]'), path.replace(/[^a-z0-9]+/gi, '-'))",
    '    })',
    '  }',
    '}, 120_000)',
  ].join('\n')
}

/**
 * Write a fixture directory with a preload and generated suites.
 * @param files - Suite sources keyed by file name.
 * @returns The fixture directory and activity log path.
 */
function fixture(files: Record<string, string>): { activity: string, dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'basis-snapshot-runtime-'))
  created.push(dir)
  /*
   * The generated suite is a real test file that may use JSX, so `react` and
   * `react-dom` must resolve from its directory. Point at the repository's
   * installed dependencies instead of installing a second copy.
   */
  symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
  writeFileSync(
    join(dir, 'bunfig.toml'),
    `[test]\npreload = [${JSON.stringify(preload)}]\n`,
  )
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return { activity: join(dir, 'activity.log'), dir }
}

/**
 * Count files below a directory, recursively.
 * @param directory - The directory to walk.
 * @returns The matching file names.
 */
function walk(directory: string): string[] {
  const found: string[] = []
  if (!existsSync(directory)) return found
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

/** Counted lifecycle events from a fixture run. */
interface Activity {
  /** Browser connections. */
  connects: number,
  /** Container starts. */
  containers: number,
  /** Teardowns. */
  teardowns: number,
}

/**
 * Read and count the runtime activity log.
 * @param path - The activity log path.
 * @returns The counted events.
 */
function readActivity(path: string): Activity {
  if (!existsSync(path)) return { connects: 0, containers: 0, teardowns: 0 }
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  return {
    connects: lines.filter(line => line.startsWith('browser-connect')).length,
    containers: lines.filter(line => line.startsWith('container-start')).length,
    teardowns: lines.filter(line => line.startsWith('teardown')).length,
  }
}

describe('snapshot runtime lifecycle', () => {
  test('starts one container and one browser for many captures across several files', async () => {
    const target = fixture({
      'application.test.tsx': applicationSuite(),
      'components-a.test.tsx': componentSuite('a', FIRST_COMPONENTS),
      'components-b.test.tsx': componentSuite('b', SECOND_COMPONENTS),
    })

    /*
     * Measure warm-runtime performance: ensure the pinned image is present so a
     * cold pull never counts as a snapshot regression. The run must start the
     * container itself, so this only warms the image, not the runtime.
     */
    Bun.spawnSync(['docker', 'pull', snapshotImage()], { stderr: 'ignore', stdout: 'ignore' })

    const start = Bun.nanoseconds()
    const proc = Bun.spawn([process.execPath, 'test', '--timeout', '60000'], {
      cwd: target.dir,
      env: {
        ...process.env,
        [SNAPSHOT_ACTIVITY_LOG]: target.activity,
        UPDATE_SNAPSHOTS: '1',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const stdout = new Response(proc.stdout).text()
    const stderr = new Response(proc.stderr).text()
    const code = await proc.exited
    const durationMs = (Bun.nanoseconds() - start) / 1_000_000
    const output = `${await stdout}\n${await stderr}`
    const activity = readActivity(target.activity)
    const expected = FIRST_COMPONENTS + SECOND_COMPONENTS + (2 * REPEATS) + VISITS.length

    const snapshots = walk(join(target.dir, '__screenshots__'))
      .filter(path => path.endsWith('.png') && !path.includes('.actual.') && !path.includes('.diff.'))

    process.stdout.write(
      `[basis/testing] runtime benchmark: ${expected} snapshots in ${durationMs.toFixed(0)}ms ` +
        `(containers=${activity.containers}, connects=${activity.connects}, teardowns=${activity.teardowns})\n`,
    )
    if (code !== 0) process.stdout.write(output)

    expect(output).toContain('pass')
    expect(code).toBe(0)
    expect(snapshots.length).toBe(expected)
    expect(activity.containers).toBe(1)
    expect(activity.connects).toBe(1)
    expect(activity.teardowns).toBe(1)
    // A run that reached for a browser per capture would blow far past this.
    expect(durationMs).toBeLessThan(30_000)
  }, 120_000)
})
