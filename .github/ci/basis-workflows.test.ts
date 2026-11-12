import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Job {
  'if'?: string,
  'name'?: string,
  'needs'?: string[],
  'permissions'?: Record<string, string>,
  'runs-on'?: string,
  'steps'?: Step[],
}

interface Step {
  env?: Record<string, string>,
  name?: string,
  run?: string,
  uses?: string,
  with?: Record<string, string>,
}

interface Workflow {
  concurrency?: {
    'cancel-in-progress'?: boolean,
    'group'?: string,
  },
  jobs?: Record<string, Job>,
  name?: string,
  on?: Record<string, { branches?: string[], types?: string[] }>,
  permissions?: Record<string, string>,
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Load and parse a Basis workflow.
 * @param path - Repository-relative workflow path.
 * @returns The parsed workflow.
 */
function loadWorkflow(path: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(root, path), 'utf8')) as Workflow
}

/**
 * Run a workflow gate script with a synthetic `needs` context.
 * @param script - The gate script.
 * @param needs - The synthetic needs object.
 * @param extra - Additional environment values.
 * @returns The process exit code and output.
 */
function runGate(
  script: string,
  needs: Record<string, { result: string }>,
  extra: Record<string, string> = {},
): {
  code: number,
  output: string,
} {
  const process = Bun.spawnSync(['bash', '-c', script], {
    env: {
      ...Bun.env,
      DECISION: '{"decision":true}',
      DECISION_HASH: 'hash',
      LANES: JSON.stringify({
        database: false,
        docs: false,
        e2e: false,
        lifecycle: false,
        unit: false,
      }),
      NEEDS: JSON.stringify(needs),
      ...extra,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  return {
    code: process.exitCode ?? -1,
    output: `${new TextDecoder().decode(process.stdout)}${new TextDecoder().decode(process.stderr)}`,
  }
}

/**
 * Run the actual lane-decision shell step against a synthetic decision file.
 * @param decision - Decision JSON written to `impact-decision.json`.
 * @returns The process exit code and output.
 */
function runLaneStep(decision: unknown): { code: number, output: string } {
  const step = code.jobs?.impact?.steps?.find(entry => entry.name === 'Derive test-lane decisions')
  if (!step?.run) throw new Error('lane decision step is missing')
  const directory = mkdtempSync(join(tmpdir(), 'basis-impact-lanes-'))
  const outputFile = join(directory, 'github-output')
  try {
    writeFileSync(join(directory, 'impact-decision.json'), JSON.stringify(decision))
    writeFileSync(outputFile, '')
    const process = Bun.spawnSync(['bash', '-c', step.run], {
      cwd: directory,
      env: { ...Bun.env, GITHUB_OUTPUT: outputFile, POLICY_PRESENT: 'true' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    return {
      code: process.exitCode ?? -1,
      output: `${new TextDecoder().decode(process.stdout)}${new TextDecoder().decode(process.stderr)}` +
        readFileSync(outputFile, 'utf8'),
    }
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

/**
 * The gate step for a required job.
 * @param workflow - The parsed workflow.
 * @returns The gate script.
 */
function gateScript(workflow: Workflow): string {
  const step = workflow.jobs?.required?.steps?.find(entry => entry.name?.startsWith('Require'))
  return step?.run ?? ''
}

const code = loadWorkflow('.github/workflows/ci.yml')
const metadata = loadWorkflow('.github/workflows/pr-metadata.yml')

/** Every impact lane the Basis workflow reports. */
const laneNames = ['unit', 'database', 'e2e', 'lifecycle', 'docs']

/** Test-suite lanes consolidated into one scheduled job. */
const laneGroups: Record<string, string[]> = {
  database: ['database'],
  e2e: ['e2e'],
  lifecycle: ['lifecycle'],
  unit: ['unit', 'docs'],
}

/** Every code job the required gate judges. */
const workflowJobs = [
  'eslint', 'impact', 'unit', 'database', 'e2e', 'lifecycle',
  'type-check', 'knip', 'consumer-install',
]

/**
 * Find whether one job runs a command.
 * @param id - Workflow job id.
 * @param command - Command text.
 * @returns True when a step runs the command.
 */
function runs(id: string, command: string): boolean {
  return code.jobs?.[id]?.steps?.some(step => step.run?.includes(command)) ?? false
}

describe('Basis Code CI', () => {
  test('runs only the code events on main and epic branches', () => {
    expect(code.name).toBe('Code CI')
    expect(code.on?.pull_request?.branches).toEqual(['main', 'epic/*'])
    expect(code.on?.pull_request?.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
    ])
    expect(code.on?.pull_request?.types).not.toContain('edited')
    expect(code.on?.pull_request?.types).not.toContain('converted_to_draft')
    expect(code.on?.pull_request?.types).not.toContain('closed')
  })

  test('skips every code job on drafts and has no edit skip path', () => {
    for (const id of [...workflowJobs, 'required']) {
      const job = code.jobs?.[id]
      expect(job).toBeDefined()
      expect(job?.if).toContain('!github.event.pull_request.draft')
      expect(job?.if).not.toContain('github.event.action')
    }
    expect(code.jobs?.['check-pr-title']).toBeUndefined()
  })

  test('keeps the quality jobs and every test lane command', () => {
    const eslint = code.jobs?.eslint?.steps ?? []
    expect(eslint.some(step => step.run?.includes('bun ./node_modules/eslint/bin/eslint.js'))).toBe(true)
    expect(eslint.some(step => step.run?.includes('stylelint'))).toBe(true)
    expect(eslint.some(step => step.run === 'bun run lint:md')).toBe(true)

    const unit = code.jobs?.unit?.steps?.find(step => (
      step.name === 'Run unit tests, screenshots and docs concurrently'
    ))?.run ?? ''
    expect(unit).toContain('bun run test:unit')
    expect(unit).toContain('bun run docs:check')
    expect(runs('database', 'bun run test:database')).toBe(true)
    expect(runs('database', 'verify-database-activity.ts')).toBe(true)
    expect(runs('e2e', 'bun run test:e2e')).toBe(true)
    expect(runs('lifecycle', 'bun run test:lifecycle')).toBe(true)
    expect(runs('type-check', 'bun run lint:ts')).toBe(true)
    expect(runs('consumer-install', 'bun run test:consumer')).toBe(true)
    expect(code.jobs?.knip?.steps?.some(step => step.uses?.includes('/knip'))).toBe(true)
  })

  test('sets up the pinned Bun toolchain and frozen dependencies', () => {
    const jobs = workflowJobs
    for (const id of jobs) {
      const steps = code.jobs?.[id]?.steps ?? []
      const setup = steps.find(step => step.uses === 'oven-sh/setup-bun@v2')
      expect(setup?.with?.['bun-version-file']).toBe('.tool-versions')
      expect(steps.some(step => step.run === 'bun install --frozen-lockfile')).toBe(true)
    }

    const databaseImage = loadWorkflow('.github/workflows/database-image.yml')
    const databaseSteps = databaseImage.jobs?.publish?.steps ?? []
    expect(databaseSteps.find(step => step.uses === 'oven-sh/setup-bun@v2')?.with?.['bun-version-file'])
      .toBe('.tool-versions')
    expect(databaseSteps.some(step => step.run === 'bun install --frozen-lockfile')).toBe(true)
    expect(existsSync(join(root, '.github/actions/asdf-setup'))).toBe(false)
  })

  test('preflights trusted change impact before split lane jobs', () => {
    const preflight = code.jobs?.impact?.steps ?? []
    const checkout = preflight.find(step => step.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.base.sha }}')
    expect(checkout?.with?.['fetch-depth']).toBe(0)

    const fetch = preflight.find(step => step.name === 'Fetch pull-request head and base')
    expect(fetch?.env?.BASE_REF).toBe('${{ github.event.pull_request.base.ref }}')
    expect(fetch?.env?.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}')
    expect(fetch?.run).toContain('refs/pull/${PR_NUMBER}/head')
    expect(fetch?.run).toContain('git checkout --detach refs/remotes/origin/pr-head')

    const impact = preflight.find(step => step.name === 'Analyze change impact')
    expect(impact?.uses).toBe('TroyAlford/basis/.github/actions/change-impact@v7.11.0')
    expect(impact?.with?.['config-path']).toBe('.github/ci-impact.json')
    expect(impact?.with?.['head-sha']).toBe('${{ github.event.pull_request.head.sha }}')

    const lanes = preflight.find(step => step.name === 'Derive test-lane decisions')
    expect(lanes?.run).toContain('impact-decision.json')
    expect(lanes?.run).toContain('lanes=')
    expect(code.jobs?.impact?.outputs?.lanes).toContain('steps.lanes.outputs.lanes')

    for (const [job, group] of Object.entries(laneGroups)) {
      expect(code.jobs?.[job]?.if).toContain('needs.impact.outputs.lanes')
      for (const lane of group) {
        expect(code.jobs?.[job]?.if).toContain(`fromJSON(needs.impact.outputs.lanes).${lane}`)
      }
    }
  })

  test('preserves false lane decisions and rejects malformed decisions', () => {
    const suites = Object.fromEntries(laneNames.map(lane => [lane, { needed: lane !== 'unit' }]))
    const valid = runLaneStep({ suites })
    expect(valid.code).toBe(0)
    expect(valid.output).toContain('"unit":false')
    expect(valid.output).toContain('"database":true')
    expect(valid.output).toContain('"lifecycle":true')

    const malformed = runLaneStep({ suites: { ...suites, unit: { needed: 'yes' } } })
    expect(malformed.code).not.toBe(0)
    expect(malformed.output).toContain('is not a boolean')

    const missing = runLaneStep({ suites: { unit: { needed: false } } })
    expect(missing.code).toBe(0)
    expect(missing.output).toContain('"unit":false')
    expect(missing.output).toContain('"database":true')
  })

  test('uses a per-PR concurrency group that ignores the event action', () => {
    expect(code.concurrency?.group).toContain('github.workflow')
    expect(code.concurrency?.group).toContain('github.event.pull_request.number')
    expect(code.concurrency?.group).not.toContain('github.event.action')
    expect(code.concurrency?.['cancel-in-progress']).toBe(true)
  })

  test('is read-only and has one named required gate', () => {
    expect(code.permissions).toEqual({ contents: 'read' })
    const required = code.jobs?.required
    expect(required?.name).toBe('required')
    expect(required?.if).toContain('always()')
    expect(required?.if).toContain('!github.event.pull_request.draft')
    expect(required?.needs).toEqual([
      'eslint', 'impact', 'unit', 'database', 'e2e', 'lifecycle',
      'type-check', 'knip', 'consumer-install',
    ])

    const script = gateScript(code)
    expect(script).not.toContain('gh api')
    expect(script).not.toContain('REUSE_')
    expect(script).toContain('eslint impact type-check knip consumer-install')
    expect(script).toContain('!= "success"')
    expect(script).toContain('DECISION_HASH')
  })

  test('fails the gate for failures, missing jobs, malformed evidence and needed skips', () => {
    const script = gateScript(code)
    const jobs = workflowJobs
    const allSuccess = Object.fromEntries(jobs.map(id => [id, { result: 'success' }]))
    expect(runGate(script, allSuccess).code).toBe(0)

    const groupJobs = Object.keys(laneGroups)
    for (const job of jobs) {
      for (const result of ['failure', 'cancelled']) {
        expect(runGate(script, { ...allSuccess, [job]: { result } }).code).toBe(1)
      }
      expect(runGate(script, {
        ...allSuccess,
        [job]: { result: 'skipped' },
      }).code).toBe(groupJobs.includes(job) ? 0 : 1)
    }

    for (const job of jobs) {
      const missing = Object.fromEntries(
        Object.entries(allSuccess).filter(([key]) => key !== job),
      )
      expect(runGate(script, missing).code).toBe(1)
    }

    expect(runGate(script, allSuccess, { DECISION: '', DECISION_HASH: '' }).code).toBe(1)
    expect(runGate(script, allSuccess, { LANES: 'null' }).code).toBe(1)
    expect(runGate(script, allSuccess, {
      LANES: JSON.stringify({ unit: true }),
    }).code).toBe(1)
    const needed = Object.fromEntries(laneNames.map(lane => [lane, false]))
    needed.database = true
    expect(runGate(script, {
      ...allSuccess,
      database: { result: 'skipped' },
    }, { LANES: JSON.stringify(needed) }).code).toBe(1)
  }, 120_000)
})

describe('Basis PR Metadata', () => {
  test('runs on title and description edits as well as code events', () => {
    expect(metadata.name).toBe('PR Metadata')
    expect(metadata.on?.pull_request?.branches).toEqual(['main'])
    expect(metadata.on?.pull_request?.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
      'edited',
    ])
  })

  test('runs the existing title action and no code jobs', () => {
    const job = metadata.jobs?.['check-pr-title']
    expect(job).toBeDefined()
    expect(job?.if).toBeUndefined()
    expect(job?.steps?.some(step => step.uses === './.github/actions/enforce-convco')).toBe(true)
    expect(job?.steps?.some(step => step.with?.['github-token'] === '${{ secrets.GITHUB_TOKEN }}')).toBe(true)

    for (const id of ['eslint', 'run-tests', 'type-check', 'knip', 'consumer-install']) {
      expect(metadata.jobs?.[id]).toBeUndefined()
    }
  })

  test('has a distinct per-PR concurrency group', () => {
    expect(metadata.concurrency?.group).toContain('github.workflow')
    expect(metadata.concurrency?.group).toContain('github.event.pull_request.number')
    expect(metadata.concurrency?.group).not.toContain('github.event.action')
    expect(metadata.concurrency?.['cancel-in-progress']).toBe(true)
    expect(metadata.name).not.toBe(code.name)
  })

  test('has one named required gate that judges only this run', () => {
    const required = metadata.jobs?.required
    expect(required?.name).toBe('metadata')
    expect(required?.if).toBe('always()')
    expect(required?.needs).toEqual(['check-pr-title'])

    const script = gateScript(metadata)
    expect(script).not.toContain('gh api')
    expect(script).not.toContain('REUSE_')
    expect(script).toContain('check-pr-title')
    expect(script).toContain('!= "success"')
  })

  test('fails the gate unless the title check succeeded in this run', () => {
    const script = gateScript(metadata)
    expect(runGate(script, { 'check-pr-title': { result: 'success' } }).code).toBe(0)

    for (const result of ['failure', 'skipped', 'cancelled']) {
      expect(runGate(script, { 'check-pr-title': { result } }).code).toBe(1)
    }

    expect(runGate(script, {}).code).toBe(1)
  })
})
