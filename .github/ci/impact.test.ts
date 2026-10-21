import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChangedFile, ImpactConfig, ImpactDecision } from '../actions/change-impact/index'
import { analyze, changedFiles, decisionHash } from '../actions/change-impact/index'

/*
 * Deterministic matrix for the portable change-impact analyzer.
 *
 * The decision tests use real files and real import scanning without git, so
 * each case is fast. The CLI tests use a throwaway git repository to prove
 * merge-base, rename/deletion, policy-from-base and GITHUB_OUTPUT behavior.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const configText = readFileSync(join(root, 'docs/examples/ci-impact.json'), 'utf8')
const config = JSON.parse(configText) as ImpactConfig
const INDEX = join(root, '.github/actions/change-impact/index.ts')
const CONFIG_PATH = '.github/ci-impact.json'
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/**
 * Create a temporary workspace populated with files.
 * @param files Map of repo-relative paths to content.
 * @returns The workspace root.
 */
async function workspace(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'basis-impact-'))
  directories.push(directory)
  for (const [path, content] of Object.entries(files)) {
    const full = join(directory, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return directory
}

/**
 * Build a changed-file record.
 * @param path New or only path.
 * @param status Git status letter.
 * @param oldPath Old path for a rename.
 * @returns The changed-file record.
 */
function change(path: string, status = 'M', oldPath?: string): ChangedFile {
  return { oldPath, path, status }
}

/**
 * Analyze changes in a temporary workspace.
 * @param files Files that exist at head.
 * @param changes Changed-file records.
 * @returns The decision.
 */
async function decide(files: Record<string, string>, changes: ChangedFile[]): Promise<ImpactDecision> {
  const cwd = await workspace(files)
  return analyze({
    changedFiles: changes,
    config,
    configText,
    cwd,
    headSha: 'b'.repeat(40),
    mergeBase: 'a'.repeat(40),
  })
}

/**
 * List the suite keys that need to run.
 * @param decision A decision.
 * @returns Sorted needed suite keys.
 */
function needed(decision: ImpactDecision): string[] {
  return Object.entries(decision.suites)
    .filter(([, suite]) => suite.needed)
    .map(([key]) => key)
    .sort()
}

/**
 * Run a git command in a repository.
 * @param cwd Repository root.
 * @param args Arguments after `git`.
 */
function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
}

/**
 * Run a git command and return trimmed standard output.
 * @param cwd Repository root.
 * @param args Arguments after `git`.
 * @returns Trimmed standard output.
 */
function gitOutput(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
  return new TextDecoder().decode(result.stdout).trim()
}

/**
 * Clone a repository into a temporary directory.
 * @param source Repository path to clone.
 * @returns The clone root.
 */
async function clone(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'basis-impact-clone-'))
  directories.push(directory)
  git(directory, ['clone', '-q', source, '.'])
  git(directory, ['config', 'user.email', 'test@example.com'])
  git(directory, ['config', 'user.name', 'Test'])
  return directory
}

/**
 * Create a temporary git repository with a committed base.
 * @param files Base files.
 * @returns The repository root.
 */
async function gitRepo(files: Record<string, string>): Promise<string> {
  const directory = await workspace(files)
  git(directory, ['init', '-q', '-b', 'main'])
  git(directory, ['config', 'user.email', 'test@example.com'])
  git(directory, ['config', 'user.name', 'Test'])
  git(directory, ['add', '-A'])
  git(directory, ['commit', '-qm', 'base'])
  return directory
}

/**
 * Run the change-impact CLI.
 * @param cwd Repository root.
 * @param args Extra arguments.
 * @param env Extra environment.
 * @returns The process result and parsed decision.
 */
function cli(cwd: string, args: string[] = [], env: Record<string, string> = {}): {
  code: number,
  decision: ImpactDecision | null,
  output: string,
} {
  const result = Bun.spawnSync(
    ['bun', INDEX, '--cwd', cwd, '--config-path', CONFIG_PATH, ...args],
    {
      env: { ...(process.env as Record<string, string>), ...env },
      stderr: 'pipe',
      stdout: 'pipe',
    },
  )
  const output = new TextDecoder().decode(result.stdout)
  const error = new TextDecoder().decode(result.stderr)
  return {
    code: result.exitCode ?? -1,
    decision: result.exitCode === 0 ? JSON.parse(output) as ImpactDecision : null,
    output: `${output}${error}`,
  }
}

describe('docs and non-code changes', () => {
  test('an untested markdown file runs no code suite', async () => {
    const decision = await decide({ 'CHANGELOG.md': '# Changelog\n' }, [change('CHANGELOG.md')])
    expect(decision.docsOnly).toBe(true)
    expect(needed(decision)).toEqual([])
  })

  test('a checked docs page runs only the docs suite', async () => {
    const decision = await decide({ 'docs/guide.md': '# Guide\n' }, [change('docs/guide.md')])
    expect(decision.docsOnly).toBe(true)
    expect(needed(decision)).toEqual(['docs'])
    expect(decision.suites.docs.reason).toBe('unreachable-source-conservative')
  })

  test('README is a checked documentation input', async () => {
    const decision = await decide({ 'README.md': '# Readme\n' }, [change('README.md')])
    expect(needed(decision)).toEqual(['docs'])
  })

  test('a mixed docs and backend change keeps docs and backend suites', async () => {
    const decision = await decide(
      { 'docs/guide.md': '# Guide\n', 'src/server.ts': 'export const server = 1\n' },
      [change('docs/guide.md'), change('src/server.ts')],
    )
    expect(decision.docsOnly).toBe(false)
    expect(needed(decision)).toEqual(['docs', 'integration', 'quality', 'unit'])
  })

  test('a docs example used by contract tests runs the owning suite too', async () => {
    const decision = await decide(
      { 'docs/examples/consumer-ci.yml': 'name: CI\n' },
      [change('docs/examples/consumer-ci.yml')],
    )
    expect(decision.suites.docs.needed).toBe(true)
    expect(decision.suites.unit.needed).toBe(true)
  })
})

describe('import graph and path rules', () => {
  test('a backend-only change skips the visual suite', async () => {
    const decision = await decide(
      { 'src/server.ts': 'export const server = 1\n' },
      [change('src/server.ts')],
    )
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit'])
    expect(decision.suites.visual.needed).toBe(false)
  })

  test('a component change selects the unit test that imports it', async () => {
    const decision = await decide(
      {
        'src/Button.test.tsx': "import { Button } from './Button'\ntest('button', () => Button)\n",
        'src/Button.tsx': 'export const Button = 1\n',
      },
      [change('src/Button.tsx')],
    )
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
    expect(decision.suites.unit.reason).toBe('import-reachable')
    expect(decision.suites.unit.selectedTests).toEqual(['src/Button.test.tsx'])
  })

  test('a transitive import selects the root test', async () => {
    const decision = await decide(
      {
        'src/a.test.ts': "import './a'\ntest('a', () => {})\n",
        'src/a.ts': "import './b'\nexport const a = 1\n",
        'src/b.ts': 'export const b = 1\n',
      },
      [change('src/b.ts')],
    )
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.selectedTests).toEqual(['src/a.test.ts'])
  })

  test('an alias is resolved through the policy', async () => {
    const decision = await decide(
      {
        'consumer/react.test.ts': "import 'basis/react'\ntest('react', () => {})\n",
        'consumer/react.ts': 'export const react = 1\n',
      },
      [change('consumer/react.ts')],
    )
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.selectedTests).toEqual(['consumer/react.test.ts'])
  })

  test('a dynamic import falls back conservatively', async () => {
    const decision = await decide(
      {
        'src/a.ts': 'export const a = 1\n',
        'src/dynamic.test.ts': "const name = './a'\nimport(name)\ntest('dynamic', () => {})\n",
      },
      [change('src/a.ts')],
    )
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.reason).toBe('dynamic-import-conservative')
  })

  test('an import.meta.glob falls back conservatively', async () => {
    const decision = await decide(
      {
        'src/a.ts': 'export const a = 1\n',
        'src/glob.test.ts': "const modules = import.meta.glob('./*.ts')\ntest('glob', () => modules)\n",
      },
      [change('src/a.ts')],
    )
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.reason).toBe('dynamic-import-conservative')
  })

  test('a stylesheet change always runs visual', async () => {
    const decision = await decide({ 'src/theme.css': 'body { color: black }\n' }, [change('src/theme.css')])
    expect(needed(decision)).toEqual(['quality', 'visual'])
    expect(decision.suites.visual.reason).toBe('always-run')
  })

  test('a screenshot baseline always runs visual', async () => {
    const decision = await decide(
      { 'src/__screenshots__/button.png': 'not really a png' },
      [change('src/__screenshots__/button.png')],
    )
    expect(needed(decision)).toEqual(['visual'])
  })

  test('a visual test change does not run unit', async () => {
    const decision = await decide(
      { 'src/Button.visual.test.tsx': "test('visual', () => {})\n" },
      [change('src/Button.visual.test.tsx')],
    )
    expect(needed(decision)).toEqual(['quality', 'visual'])
  })

  test('a unit test change does not run visual', async () => {
    const decision = await decide(
      { 'src/Button.test.tsx': "test('unit', () => {})\n" },
      [change('src/Button.test.tsx')],
    )
    expect(needed(decision)).toEqual(['quality', 'unit'])
  })
})

describe('conservative policy rules', () => {
  test('a lockfile change runs every code suite', async () => {
    const decision = await decide({ 'bun.lock': 'lock\n' }, [change('bun.lock')])
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
  })

  test('a toolchain change runs every code suite', async () => {
    const decision = await decide({ '.tool-versions': 'bun 1.4.2\n' }, [change('.tool-versions')])
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
  })

  test('a test preload change runs the suites that use it', async () => {
    const decision = await decide({ 'bunfig.toml': '[test]\n' }, [change('bunfig.toml')])
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
  })

  test('a renamed source file runs the affected suite', async () => {
    const decision = await decide({ 'src/a2.ts': 'export const a = 1\n' }, [change('src/a2.ts', 'R', 'src/a.ts')])
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.reason).toBe('deleted-or-renamed-source')
  })

  test('a deleted source file runs the affected suite', async () => {
    const decision = await decide({}, [change('src/a.ts', 'D')])
    expect(decision.suites.unit.needed).toBe(true)
    expect(decision.suites.unit.reason).toBe('deleted-or-renamed-source')
  })

  test('an unknown file fails closed across every code suite', async () => {
    const decision = await decide({ 'assets/data.bin': 'binary\n' }, [change('assets/data.bin')])
    expect(needed(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
    for (const key of ['integration', 'quality', 'unit', 'visual']) {
      expect(decision.suites[key].reason).toBe('unknown-change-conservative')
      expect(decision.suites[key].unknownFiles).toEqual(['assets/data.bin'])
    }
  })
})

describe('reference workflow propagation', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(join(root, 'docs/examples/consumer-ci.yml'), 'utf8'),
  ) as {
    jobs: Record<string, { if?: string, outputs?: Record<string, string> }>,
  }
  const suiteJobs: Record<string, string> = {
    docs: 'docs',
    integration: 'integration',
    quality: 'quality',
    unit: 'unit',
    visual: 'visual',
  }

  /**
   * Map a decision to the reference suite jobs that should run.
   * @param decision An exact-head decision.
   * @returns Sorted job ids.
   */
  function scheduled(decision: ImpactDecision): string[] {
    return Object.entries(suiteJobs)
      .filter(([, key]) => decision.suites[key]?.needed)
      .map(([job]) => job)
      .sort()
  }

  test('republishes each consumed suite output at job scope', () => {
    const outputs = workflow.jobs.impact.outputs ?? {}
    expect(outputs.decision).toBe('${{ steps.impact.outputs.decision }}')
    expect(outputs['decision-hash']).toBe('${{ steps.impact.outputs.decision-hash }}')
    for (const [job, key] of Object.entries(suiteJobs)) {
      expect(outputs[`${key}-needed`]).toBe(`\${{ steps.impact.outputs.${key}-needed }}`)
      expect(workflow.jobs[job]?.if).toContain(`needs.impact.outputs.${key}-needed == 'true'`)
    }
  })

  test('a docs-only change schedules only docs', async () => {
    const decision = await decide({ 'docs/guide.md': '# Guide\n' }, [change('docs/guide.md')])
    expect(scheduled(decision)).toEqual(['docs'])
  })

  test('a backend-only change schedules quality, unit and integration', async () => {
    const decision = await decide(
      { 'src/server.ts': 'export const server = 1\n' },
      [change('src/server.ts')],
    )
    expect(scheduled(decision)).toEqual(['integration', 'quality', 'unit'])
  })

  test('a UI change schedules quality, unit, integration and visual', async () => {
    const decision = await decide(
      {
        'src/Button.test.tsx': "import { Button } from './Button'\ntest('button', () => Button)\n",
        'src/Button.tsx': 'export const Button = 1\n',
      },
      [change('src/Button.tsx')],
    )
    expect(scheduled(decision)).toEqual(['integration', 'quality', 'unit', 'visual'])
  })
})

describe('git integration', () => {
  test('uses the exact merge base rather than the base branch head', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await mkdir(join(repo, '.github'), { recursive: true })
    await writeFile(join(repo, CONFIG_PATH), configText)
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'config'])
    git(repo, ['branch', 'feature'])
    await writeFile(join(repo, 'src/main-only.ts'), 'export const mainOnly = 1\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'main-only'])
    git(repo, ['checkout', '-q', 'feature'])
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'feature'])

    const result = cli(repo, ['--base-ref', 'main', '--head-sha', 'feature'])
    expect(result.code).toBe(0)
    expect(result.decision?.changedFiles.map(file => file.path)).toEqual(['src/a.ts'])
  })

  test('reads the policy from the merge base, not the pull-request head', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await mkdir(join(repo, '.github'), { recursive: true })
    await writeFile(join(repo, CONFIG_PATH), configText)
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'config'])
    const weakened = '{"version":1,"suites":{"unit":{"testGlobs":[],"sourceGlobs":[],' +
      '"ignoreGlobs":["**"],"mode":"paths"}}}'
    await writeFile(join(repo, CONFIG_PATH), weakened)
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'weakened-policy'])

    const result = cli(repo, ['--base-ref', 'HEAD~1'])
    expect(result.code).toBe(0)
    expect(result.decision?.suites.unit.needed).toBe(true)
  })

  test('enumerates a rename with its old path', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    git(repo, ['mv', 'src/a.ts', 'src/b.ts'])
    git(repo, ['commit', '-qm', 'rename'])
    const files = changedFiles(repo, 'HEAD~1', 'HEAD')
    expect(files).toEqual([{ oldPath: 'src/a.ts', path: 'src/b.ts', status: 'R' }])
  })

  test('fails closed when the base policy is absent', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'change'])
    const result = cli(repo, ['--base-ref', 'HEAD~1'])
    expect(result.code).toBe(1)
    expect(result.output).toContain('git show')
  })

  test('fails closed on an invalid policy schema', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await mkdir(join(repo, '.github'), { recursive: true })
    await writeFile(join(repo, CONFIG_PATH), '{"version":1,"suites":{"unit":{}}}')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'invalid-config'])
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'change'])

    const result = cli(repo, ['--base-ref', 'HEAD~1'])
    expect(result.code).toBe(1)
    expect(result.output).toContain('testGlobs')
  })

  test('writes the decision, hash and convenience outputs', async () => {
    const repo = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await mkdir(join(repo, '.github'), { recursive: true })
    await writeFile(join(repo, CONFIG_PATH), configText)
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'config'])
    await writeFile(join(repo, 'src/a.ts'), 'export const a = 2\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'change'])
    const outputFile = join(repo, 'github-output.txt')
    const result = cli(repo, ['--base-ref', 'HEAD~1', '--output', 'impact-decision.json'], {
      GITHUB_OUTPUT: outputFile,
    })
    expect(result.code).toBe(0)
    const output = await readFile(outputFile, 'utf8')
    expect(output).toContain('decision<<__BASIS_IMPACT_DECISION__')
    expect(output).toContain('unit-needed=true')
    expect(output).toContain(`decision-hash=${decisionHash(result.decision as ImpactDecision)}`)
  })
})

describe('fork pull request topology', () => {
  test('fetches the PR head from the base repository and analyzes the exact head', async () => {
    const base = await gitRepo({ 'src/a.ts': 'export const a = 1\n' })
    await mkdir(join(base, '.github'), { recursive: true })
    await writeFile(join(base, CONFIG_PATH), configText)
    git(base, ['add', '-A'])
    git(base, ['commit', '-qm', 'config'])
    const baseSha = gitOutput(base, ['rev-parse', 'HEAD'])

    const fork = await clone(base)
    git(fork, ['checkout', '-qb', 'feature'])
    await writeFile(join(fork, 'src/a.ts'), 'export const a = 2\n')
    git(fork, ['add', '-A'])
    git(fork, ['commit', '-qm', 'feature'])
    const headSha = gitOutput(fork, ['rev-parse', 'HEAD'])

    // GitHub exposes a fork head as refs/pull/<number>/head on the base repo.
    git(base, ['fetch', '--no-tags', fork, 'feature:refs/pull/1/head'])

    // Simulate actions/checkout at the base SHA, then the workflow fetch steps.
    const runner = await clone(base)
    git(runner, ['checkout', '--detach', baseSha])
    git(runner, ['fetch', '--no-tags', 'origin', 'refs/pull/1/head:refs/remotes/origin/pr-head'])
    git(runner, ['fetch', '--no-tags', 'origin', 'main'])
    expect(gitOutput(runner, ['rev-parse', 'refs/remotes/origin/pr-head'])).toBe(headSha)
    git(runner, ['checkout', '--detach', 'refs/remotes/origin/pr-head'])

    const result = cli(runner, ['--base-ref', 'origin/main', '--head-sha', headSha])
    expect(result.code).toBe(0)
    expect(result.decision?.headSha).toBe(headSha)
    expect(result.decision?.mergeBase).toBe(baseSha)
    expect(result.decision?.changedFiles.map(file => file.path)).toEqual(['src/a.ts'])
    expect(result.decision?.suites.unit.needed).toBe(true)
  })
})
