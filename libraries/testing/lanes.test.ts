import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirectory } from './temp'

/*
 * The custom-suffix lanes are opt-in, so their behavior cannot be exercised by
 * the repository's default `bun test` discovery. These cases generate real
 * fixture files, run them in real child processes, and assert the public
 * matcher, test registration, and pruning scope from the outside.
 */

const repoRoot = join(import.meta.dir, '..', '..')
const preload = join(repoRoot, 'libraries', 'testing', 'bun.ts')
const caller = join(repoRoot, 'libraries', 'testing', 'caller.ts')
const matcher = join(repoRoot, 'libraries', 'testing', 'matchScreenshot.ts')
const snapshots = join(repoRoot, 'libraries', 'testing', 'snapshots.ts')
const testModule = join(repoRoot, 'libraries', 'testing', 'test.ts')

/** Fixture directories created by this test, removed after the run. */
const created: string[] = []

afterAll(() => {
  for (const directory of created) rmSync(directory, { force: true, recursive: true })
})

/** The suffix-specific part of a generated fixture. */
interface Lane {
  /** Element expression valid in the fixture's language. */
  element: string,
  /** Extra imports the element needs. */
  imports: string[],
  /** Fixture filename. */
  name: string,
}

const SCREENSHOT: Lane = {
  element: '<span>lane</span>',
  imports: [],
  name: 'lane.screenshot.tsx',
}

const E2E: Lane = {
  element: "createElement('span', null, 'lane')",
  imports: ["import { createElement } from 'react'"],
  name: 'lane.e2e.ts',
}

/**
 * Build the shared fixture imports and helpers.
 * @param lane - The lane being generated.
 * @returns Fixture source lines.
 */
function preamble(lane: Lane): string[] {
  return [
    "import { afterAll, expect } from 'bun:test'",
    "import { existsSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "import type { Locator } from 'playwright'",
    ...lane.imports,
    `import { callerFile } from ${JSON.stringify(caller)}`,
    `import { matchScreenshot, runMatchScreenshot } from ${JSON.stringify(matcher)}`,
    `import { snapshotDirectory } from ${JSON.stringify(snapshots)}`,
    `import { currentTestName, fullyRunFiles, test } from ${JSON.stringify(testModule)}`,
    '',
    'const HERE = import.meta.path',
    "const BYTES = Buffer.from('basis-lane-capture')",
    'const TARGET = {',
    '  evaluate: async () => undefined,',
    '  screenshot: async () => BYTES,',
    '} as unknown as Locator',
    'const baseline = (stem: string): string => join(snapshotDirectory(HERE), `${stem}.png`)',
  ]
}

/**
 * A fixture that proves caller attribution, public matcher, and registration.
 * @param lane - The lane being generated.
 * @returns The fixture source.
 */
function attributionFixture(lane: Lane): string {
  return [
    ...preamble(lane),
    '',
    "test('captures a locator natively', async () => {",
    '  expect(callerFile()).toBe(HERE)',
    "  expect(currentTestName()).toBe('captures a locator natively')",
    '  await matchScreenshot(TARGET)',
    "  expect(existsSync(baseline('captures-a-locator-natively-1'))).toBe(true)",
    '})',
    '',
    "test('captures an element natively', async () => {",
    `  await runMatchScreenshot(${lane.element}, 'element', {}, { capture: async () => BYTES })`,
    "  expect(existsSync(baseline('captures-an-element-natively-element-1'))).toBe(true)",
    '})',
    '',
    'afterAll(() => {',
    '  expect(fullyRunFiles()).toContain(HERE)',
    '})',
  ].join('\n')
}

/**
 * A fixture whose fully executed update must prune an orphaned baseline.
 * @param lane - The lane being generated.
 * @returns The fixture source.
 */
function pruneFixture(lane: Lane): string {
  return [
    ...preamble(lane),
    '',
    "test('keeps the capture', async () => {",
    '  await matchScreenshot(TARGET)',
    '})',
  ].join('\n')
}

/**
 * A fixture with one selected and one filtered test.
 * @param lane - The lane being generated.
 * @returns The fixture source.
 */
function selectionFixture(lane: Lane): string {
  return [
    ...preamble(lane),
    '',
    "test('kept capture', async () => {",
    '  await matchScreenshot(TARGET)',
    '})',
    '',
    "test('filtered capture', async () => {",
    '  await matchScreenshot(TARGET)',
    '})',
  ].join('\n')
}

/**
 * A fixture with one selected and one skipped test.
 * @param lane - The lane being generated.
 * @returns The fixture source.
 */
function skipFixture(lane: Lane): string {
  return [
    ...preamble(lane),
    '',
    "test('kept capture', async () => {",
    '  await matchScreenshot(TARGET)',
    '})',
    '',
    "test.skip('skipped capture', async () => {",
    '  await matchScreenshot(TARGET)',
    '})',
  ].join('\n')
}

/**
 * A fixture whose only capture fails after its baseline was tracked.
 * @param lane - The lane being generated.
 * @returns The fixture source.
 */
function captureFailureFixture(lane: Lane): string {
  return [
    ...preamble(lane),
    '',
    "test('failed capture', async () => {",
    '  const failing = {',
    '    evaluate: async () => undefined,',
    "    screenshot: async () => { throw new Error('capture failed') },",
    '  } as unknown as Locator',
    '  await matchScreenshot(failing)',
    '})',
  ].join('\n')
}

/**
 * Write a fixture directory with a linked dependency tree.
 * @param files - Fixture sources keyed by file name.
 * @param withPreload - Whether to register the testing preload (needed for pruning).
 * @returns The fixture directory.
 */
function fixture(files: Record<string, string>, withPreload = true): string {
  const directory = tempDirectory('basis-test-lane')
  created.push(directory)
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  if (withPreload) {
    writeFileSync(
      join(directory, 'bunfig.toml'),
      `[test]\npreload = [${JSON.stringify(preload)}]\n`,
    )
  }
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content)
  }
  return directory
}

/**
 * Run a child Bun test process.
 * @param directory - The fixture directory.
 * @param args - Arguments after `test`.
 * @param env - Extra environment variables.
 * @returns The exit code and combined output.
 */
async function run(
  directory: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number, output: string }> {
  const proc = Bun.spawn([process.execPath, 'test', ...args], {
    cwd: directory,
    env: { ...process.env, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, output: `${stdout}\n${stderr}` }
}

/**
 * Resolve a fixture's snapshot directory.
 * @param directory - The fixture directory.
 * @param name - The fixture filename.
 * @returns The snapshot directory.
 */
function snapshotDir(directory: string, name: string): string {
  return join(directory, '__screenshots__', name)
}

/**
 * Write a committed baseline into a fixture's snapshot directory.
 * @param directory - The fixture directory.
 * @param name - The fixture filename.
 * @param stem - The baseline filename stem.
 * @param bytes - The baseline contents.
 */
function writeBaseline(directory: string, name: string, stem: string, bytes: string): void {
  mkdirSync(snapshotDir(directory, name), { recursive: true })
  writeFileSync(join(snapshotDir(directory, name), `${stem}.png`), bytes)
}

/**
 * Read a fixture baseline's contents.
 * @param directory - The fixture directory.
 * @param name - The fixture filename.
 * @param stem - The baseline filename stem.
 * @returns The baseline bytes.
 */
function readBaseline(directory: string, name: string, stem: string): string {
  return readFileSync(join(snapshotDir(directory, name), `${stem}.png`), 'utf8')
}

describe('custom test lanes', () => {
  for (const lane of [SCREENSHOT, E2E]) {
    test(`runs and attributes ${lane.name}`, async () => {
      const directory = fixture({ [lane.name]: attributionFixture(lane) })
      const result = await run(directory, [`./${lane.name}`])

      expect(result.output).toContain('pass')
      expect(result.code).toBe(0)
    })
  }

  test('does not auto-discover the heavy lanes from the default command', async () => {
    const directory = fixture({
      'fast.test.ts': "import { expect, test } from 'bun:test'\ntest('fast only', () => expect(1).toBe(1))\n",
      'ignored.e2e.ts': "throw new Error('e2e lane was auto-discovered')\n",
      'ignored.screenshot.tsx': "throw new Error('screenshot lane was auto-discovered')\n",
    }, false)
    const result = await run(directory, [])

    expect(result.output).not.toContain('was auto-discovered')
    expect(result.code).toBe(0)
  })

  for (const lane of [SCREENSHOT, E2E]) {
    test(`prunes an orphan after a fully executed ${lane.name} update`, async () => {
      const directory = fixture({ [lane.name]: pruneFixture(lane) })
      writeBaseline(directory, lane.name, 'keeps-the-capture-1', 'kept')
      writeBaseline(directory, lane.name, 'orphan-1', 'orphan')

      const result = await run(directory, [`./${lane.name}`], { UPDATE_SNAPSHOTS: '1' })

      expect(result.code).toBe(0)
      expect(existsSync(join(snapshotDir(directory, lane.name), 'keeps-the-capture-1.png'))).toBe(true)
      expect(existsSync(join(snapshotDir(directory, lane.name), 'orphan-1.png'))).toBe(false)
    })
  }

  test('preserves untouched baselines when -t filters a custom-suffix file', async () => {
    const directory = fixture({ [SCREENSHOT.name]: selectionFixture(SCREENSHOT) })
    writeBaseline(directory, SCREENSHOT.name, 'kept-capture-1', 'kept')
    writeBaseline(directory, SCREENSHOT.name, 'filtered-capture-1', 'filtered')

    const result = await run(directory, [`./${SCREENSHOT.name}`, '-t', 'kept capture'], {
      UPDATE_SNAPSHOTS: '1',
    })

    expect(result.code).toBe(0)
    expect(readBaseline(directory, SCREENSHOT.name, 'filtered-capture-1')).toBe('filtered')
  })

  test('preserves untouched baselines when a custom-suffix file skips a test', async () => {
    const directory = fixture({ [E2E.name]: skipFixture(E2E) })
    writeBaseline(directory, E2E.name, 'kept-capture-1', 'kept')
    writeBaseline(directory, E2E.name, 'skipped-capture-1', 'skipped')

    const result = await run(directory, [`./${E2E.name}`], { UPDATE_SNAPSHOTS: '1' })

    expect(result.code).toBe(0)
    expect(readBaseline(directory, E2E.name, 'skipped-capture-1')).toBe('skipped')
  })

  test('preserves the tracked baseline when a capture fails during an update', async () => {
    const directory = fixture({ [SCREENSHOT.name]: captureFailureFixture(SCREENSHOT) })
    writeBaseline(directory, SCREENSHOT.name, 'failed-capture-1', 'original')

    const result = await run(directory, [`./${SCREENSHOT.name}`], { UPDATE_SNAPSHOTS: '1' })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('capture failed')
    expect(readBaseline(directory, SCREENSHOT.name, 'failed-capture-1')).toBe('original')
  })
})
