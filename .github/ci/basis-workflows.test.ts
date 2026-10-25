import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
 * @returns The process exit code and output.
 */
function runGate(script: string, needs: Record<string, { result: string }>): {
  code: number,
  output: string,
} {
  const process = Bun.spawnSync(['bash', '-c', script], {
    env: { ...Bun.env, NEEDS: JSON.stringify(needs) },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  return {
    code: process.exitCode ?? -1,
    output: `${new TextDecoder().decode(process.stdout)}${new TextDecoder().decode(process.stderr)}`,
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

describe('Basis Code CI', () => {
  test('runs only the code events and never metadata edits', () => {
    expect(code.name).toBe('Code CI')
    expect(code.on?.pull_request?.branches).toEqual(['main'])
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
    for (const id of ['eslint', 'run-tests', 'type-check', 'knip', 'consumer-install', 'required']) {
      const job = code.jobs?.[id]
      expect(job).toBeDefined()
      expect(job?.if).toContain('!github.event.pull_request.draft')
      expect(job?.if).not.toContain('github.event.action')
    }
    expect(code.jobs?.['check-pr-title']).toBeUndefined()
  })

  test('keeps the five code jobs and their core commands', () => {
    const eslint = code.jobs?.eslint?.steps ?? []
    expect(eslint.some(step => step.run?.includes('bun ./node_modules/eslint/bin/eslint.js'))).toBe(true)
    expect(eslint.some(step => step.run?.includes('stylelint'))).toBe(true)
    expect(eslint.some(step => step.run === 'bun run lint:md')).toBe(true)
    expect(eslint.some(step => step.run === 'bun test consumer/cli.test.ts')).toBe(true)

    expect(code.jobs?.['run-tests']?.steps?.some(step => step.run === 'bun run test')).toBe(true)
    expect(code.jobs?.['type-check']?.steps?.some(step => step.run === 'bun run lint:ts')).toBe(true)
    expect(code.jobs?.['consumer-install']?.steps?.some(step => step.run === 'bun run test:consumer')).toBe(true)
    expect(code.jobs?.knip?.steps?.some(step => step.uses?.includes('/knip'))).toBe(true)
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
    expect(required?.needs).toEqual(['eslint', 'run-tests', 'type-check', 'knip', 'consumer-install'])

    const script = gateScript(code)
    expect(script).not.toContain('gh api')
    expect(script).not.toContain('REUSE_')
    expect(script).toContain('eslint run-tests type-check knip consumer-install')
    expect(script).toContain('!= "success"')
  })

  test('fails the gate for every non-success or missing code job', () => {
    const script = gateScript(code)
    const jobs = ['eslint', 'run-tests', 'type-check', 'knip', 'consumer-install']
    const allSuccess = Object.fromEntries(jobs.map(id => [id, { result: 'success' }]))
    expect(runGate(script, allSuccess).code).toBe(0)

    for (const job of jobs) {
      for (const result of ['failure', 'skipped', 'cancelled']) {
        const needs = { ...allSuccess, [job]: { result } }
        expect(runGate(script, needs).code).toBe(1)
      }
    }

    for (const job of jobs) {
      const missing = Object.fromEntries(
        Object.entries(allSuccess).filter(([key]) => key !== job),
      )
      expect(runGate(script, missing).code).toBe(1)
    }
  })
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
