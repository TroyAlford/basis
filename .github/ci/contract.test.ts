import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Static contract tests for the portable CI recipe.
 *
 * These parse the reference workflows with Bun's YAML parser, so the `on` key
 * is handled as a string (YAML 1.1 tooling would otherwise turn it into
 * `true`). They prove the event matrix and job graph without spending a hosted
 * runner minute. They do not prove GitHub billing, token permissions, or
 * hosted timing; `docs/ci.mdx` lists those gaps.
 */

interface Job {
  'if'?: string,
  'name'?: string,
  'needs'?: string[],
  'outputs'?: Record<string, string>,
  'permissions'?: Record<string, string>,
  'runs-on'?: string,
  'steps'?: Step[],
  'timeout-minutes'?: number,
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
  on?: Record<string, unknown>,
  permissions?: Record<string, string>,
}

interface Action {
  inputs?: Record<string, { default?: string, required?: boolean, type?: string }>,
  outputs?: Record<string, { value?: string }>,
  runs?: { steps?: Step[] },
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Load and parse a YAML file from the repository.
 * @param path Repository-relative path.
 * @returns The parsed document.
 */
function loadYaml(path: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(root, path), 'utf8')) as Workflow
}

/**
 * Load and parse a JSON fixture from the repository.
 * @param path Repository-relative path.
 * @returns The parsed fixture.
 */
function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
}

/**
 * Read the pull-request trigger from a workflow.
 * @param workflow Parsed workflow.
 * @param event Trigger name.
 * @returns The trigger mapping, or undefined when absent.
 */
function trigger(workflow: Workflow, event: string): { branches?: string[], types?: string[] } | undefined {
  return workflow.on?.[event] as { branches?: string[], types?: string[] } | undefined
}

/**
 * Read the steps of every job.
 * @param workflow Parsed workflow.
 * @returns A flat list of steps.
 */
function allSteps(workflow: Workflow): Step[] {
  return Object.values(workflow.jobs ?? {}).flatMap(job => job.steps ?? [])
}

describe('reference consumer CI', () => {
  const workflow = loadYaml('docs/examples/consumer-ci.yml')

  test('reacts to every event the contract needs', () => {
    const pullRequest = trigger(workflow, 'pull_request')
    expect(pullRequest?.branches).toContain('main')
    const types = pullRequest?.types ?? []
    for (const event of [
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
      'converted_to_draft',
    ]) {
      expect(types).toContain(event)
    }
    expect(types).toHaveLength(5)
    expect(types).not.toContain('edited')
  })

  test('uses a per-pull-request concurrency group that cancels superseded runs', () => {
    expect(workflow.concurrency?.group).toContain('github.event.pull_request.number')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true)
  })

  test('keeps the code path read-only', () => {
    expect(workflow.permissions?.contents).toBe('read')
    expect(workflow.permissions?.contents).not.toBe('write')
    expect(workflow.jobs?.required?.permissions?.checks).toBe('read')
  })

  test('skips every suite job for Draft events', () => {
    for (const id of ['quality', 'docs', 'unit', 'visual']) {
      const job = workflow.jobs?.[id]
      expect(job).toBeDefined()
      expect(job?.needs).toContain('impact')
      expect(job?.if).toContain('needs.impact.result')
      expect(job?.if).toContain('!github.event.pull_request.draft')
      expect(job?.if).toContain(`needs.impact.outputs.${id}-needed`)
    }
  })

  test('runs a cheap exact-merge-base preflight before the suites', () => {
    const job = workflow.jobs?.impact
    expect(job).toBeDefined()
    expect(job?.if).toContain('!github.event.pull_request.draft')
    expect(job?.if).not.toContain("github.event.action != 'edited'")
    expect(job?.['timeout-minutes']).toBe(5)

    const checkout = job?.steps?.find(step => step.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.['fetch-depth']).toBe(0)
    expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.base.sha }}')
    expect(checkout?.with?.repository).toBeUndefined()

    const fetch = job?.steps?.find(step => step.run?.includes('refs/pull/'))
    expect(fetch?.env?.BASE_REF).toBe('${{ github.event.pull_request.base.ref }}')
    expect(fetch?.env?.PR_NUMBER).toBe('${{ github.event.pull_request.number }}')
    expect(fetch?.env?.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}')
    expect(fetch?.run).toContain('refs/pull/${PR_NUMBER}/head:refs/remotes/origin/pr-head')
    expect(fetch?.run).toContain('git fetch --no-tags origin "$BASE_REF"')
    expect(fetch?.run).toContain('git rev-parse refs/remotes/origin/pr-head')
    expect(fetch?.run).toContain('git checkout --detach refs/remotes/origin/pr-head')

    const impact = job?.steps?.find(step => step.uses?.includes('/change-impact@'))
    expect(impact).toBeDefined()
    expect(impact?.with?.['head-sha']).toBe('${{ github.event.pull_request.head.sha }}')
    expect(impact?.with?.['base-ref']).toBe('origin/${{ github.event.pull_request.base.ref }}')
    expect(impact?.with?.['config-path']).toBe('.github/ci-impact.json')

    const artifact = job?.steps?.find(step => step.uses?.includes('/upload-artifact@'))
    expect(artifact?.with?.path).toBe('impact-decision.json')
  })

  test('republishes every consumed impact output at job scope', () => {
    const outputs = workflow.jobs?.impact?.outputs ?? {}
    const consumed = new Set<string>(['decision', 'decision-hash'])
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const match of job.if?.matchAll(/needs\.impact\.outputs\.([a-z-]+)/g) ?? []) {
        consumed.add(match[1])
      }
    }
    for (const key of consumed) {
      expect(outputs[key]).toBe(`\${{ steps.impact.outputs.${key} }}`)
    }
    for (const key of [
      'quality-needed',
      'docs-needed',
      'unit-needed',
      'visual-needed',
    ]) {
      expect(outputs[key]).toBe(`\${{ steps.impact.outputs.${key} }}`)
    }

    const verify = workflow.jobs?.impact?.steps?.find(step => step.name === 'Verify impact outputs')
    expect(verify?.run).toContain('DECISION')
    expect(verify?.env?.DECISION_HASH).toBe('${{ steps.impact.outputs.decision-hash }}')
  })

  test('consolidates lightweight checks into one job with distinct steps', () => {
    const steps = workflow.jobs?.quality?.steps ?? []
    expect(steps.some(step => step.run === 'bun run lint')).toBe(true)
    expect(steps.some(step => step.run === 'bun run typecheck')).toBe(true)
    expect(steps.some(step => step.uses?.includes('/knip@'))).toBe(true)
  })

  test('keeps unit, docs, and visual suites in separate processes', () => {
    expect(workflow.jobs?.unit?.steps?.some(step => step.run === 'bun run test')).toBe(true)
    expect(workflow.jobs?.docs?.steps?.some(step => step.run === 'bun run docs:check')).toBe(true)
    expect(workflow.jobs?.visual?.steps?.some(step => step.run === 'bun run test:screenshots')).toBe(true)
    expect(workflow.jobs?.visual?.steps?.some(step => step.run === 'bun run test:e2e')).toBe(true)
  })

  test('posts no required status on Draft events and keeps the gate checkout-free', () => {
    const required = workflow.jobs?.required
    expect(required?.name).toBe('Required')
    expect(required?.if).toContain('always()')
    expect(required?.if).toContain('!github.event.pull_request.draft')
    expect(required?.if).not.toContain("github.event.action != 'edited'")
    expect(required?.steps?.some(step => step.uses?.startsWith('actions/checkout'))).toBe(false)
  })

  test('requires the impact preflight and every suite through the portable gate', () => {
    const required = workflow.jobs?.required
    for (const id of ['impact', 'quality', 'docs', 'unit', 'visual']) {
      expect(required?.needs).toContain(id)
    }

    const gate = required?.steps?.find(step => step.uses?.includes('/required-gate@'))
    expect(gate).toBeDefined()
    expect(gate?.with?.needs).toBe('${{ toJSON(needs) }}')
    expect(gate?.with?.['head-sha']).toBe('${{ github.event.pull_request.head.sha }}')
    expect(gate?.with?.['impact-decision']).toBe('${{ needs.impact.outputs.decision }}')
    expect(gate?.with?.['impact-hash']).toBe('${{ needs.impact.outputs.decision-hash }}')
    expect(gate?.with?.['require-impact']).toBe('true')
    expect(JSON.parse(gate?.with?.['check-names'] ?? '{}')).toEqual({
      docs: 'Docs',
      quality: 'Quality',
      unit: 'Test',
      visual: 'Visual',
    })
  })

  test('uses the same caller-selectable runner everywhere', () => {
    for (const id of ['impact', 'quality', 'docs', 'unit', 'visual', 'required']) {
      expect(workflow.jobs?.[id]?.['runs-on']).toBe("${{ vars.CI_RUNNER || 'ubuntu-latest' }}")
    }
  })
})

describe('reference change-impact policy', () => {
  const policy = loadJson('docs/examples/ci-impact.json')

  test('declares the reference suites and conservative defaults', () => {
    expect(policy.version).toBe(1)
    expect(policy.maxGraphFiles).toBe(20000)
    const suites = policy.suites as Record<string, {
      unreachableSource?: string,
    }>
    expect(Object.keys(suites).sort()).toEqual(['docs', 'quality', 'unit', 'visual'])
    expect(suites.visual.unreachableSource).toBe('run')
  })
})

describe('change-impact action contract', () => {
  const action = Bun.YAML.parse(
    readFileSync(join(root, '.github/actions/change-impact/action.yml'), 'utf8'),
  ) as Action

  test('requires the exact head SHA and a policy path', () => {
    expect(action.inputs?.['head-sha']?.required).toBe(true)
    expect(action.inputs?.['config-path']?.default).toBe('.github/ci-impact.json')
    expect(action.inputs?.['base-ref']?.default).toBe('origin/main')
  })

  test('exposes the decision and its evidence hash', () => {
    expect(action.outputs).toHaveProperty('decision')
    expect(action.outputs).toHaveProperty('decision-hash')
    expect(action.outputs).toHaveProperty('policy-hash')
    expect(action.outputs).toHaveProperty('any-needed')
  })

  test('runs the analyzer from the pinned action path', () => {
    const step = action.runs?.steps?.[0]
    expect(step?.run).toContain('github.action_path')
    expect(step?.run).toContain('index.ts')
  })
})

describe('reference consumer title workflow', () => {
  const workflow = loadYaml('docs/examples/consumer-pr-title.yml')

  test('runs on ready title events without running Draft work', () => {
    const target = trigger(workflow, 'pull_request_target')
    const types = target?.types ?? []
    for (const event of ['opened', 'edited', 'reopened', 'ready_for_review', 'synchronize']) {
      expect(types).toContain(event)
    }
    expect(workflow.jobs?.title?.if).toContain('!github.event.pull_request.draft')
  })

  test('never checks out pull-request code under the write-scoped token', () => {
    expect(allSteps(workflow).some(step => step.uses?.startsWith('actions/checkout'))).toBe(false)
    expect(workflow.permissions?.contents).toBe('read')
    expect(workflow.permissions?.['pull-requests']).toBe('write')
  })

  test('delegates the title policy to the shared action', () => {
    const steps = workflow.jobs?.title?.steps ?? []
    expect(steps.some(step => step.uses?.includes('/enforce-convco@'))).toBe(true)
  })
})

describe('Basis release workflow runner choice', () => {
  const workflow = loadYaml('.github/workflows/release.yml')

  test('defaults the reusable runs-on input to ubuntu-latest', () => {
    const call = workflow.on?.workflow_call as { inputs?: Record<string, { default?: string, type?: string }> } | null
    expect(call?.inputs?.['runs-on']?.default).toBe('ubuntu-latest')
    expect(call?.inputs?.['runs-on']?.type).toBe('string')
  })

  test('applies the caller-selected runner to every job', () => {
    expect(workflow.jobs?.['determine-version']?.['runs-on']).toBe("${{ inputs.runs-on || 'ubuntu-latest' }}")
    expect(workflow.jobs?.['create-release']?.['runs-on']).toBe("${{ inputs.runs-on || 'ubuntu-latest' }}")
  })

  test('preserves the release triggers, permissions, and outputs', () => {
    const push = workflow.on?.push as { branches?: string[] } | undefined
    expect(push?.branches).toContain('main')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(workflow.on).toHaveProperty('workflow_call')
    expect(workflow.permissions?.contents).toBe('write')
    expect(workflow.jobs?.['create-release']?.needs).toContain('determine-version')
    const outputs = (workflow.jobs?.['determine-version'] as { outputs?: Record<string, string> } | undefined)?.outputs
    expect(Object.keys(outputs ?? {})).toEqual(
      expect.arrayContaining(['release-needed', 'next-version', 'current-version']),
    )
  })
})

describe('portable required gate', () => {
  const action = Bun.YAML.parse(
    readFileSync(join(root, '.github/actions/required-gate/action.yml'), 'utf8'),
  ) as Action

  test('declares the inputs the calling job must supply', () => {
    for (const input of ['github-token', 'needs', 'head-sha', 'check-names']) {
      expect(action.inputs).toHaveProperty(input)
    }
    expect(action.inputs?.['github-token']?.required).toBe(true)
    expect(action.inputs?.needs?.required).toBe(true)
    expect(action.inputs?.['head-sha']?.required).toBe(true)
  })

  test('passes the calling job context into the reducer', () => {
    const step = action.runs?.steps?.[0]
    expect(step?.env?.NEEDS).toBe('${{ inputs.needs }}')
    expect(step?.env?.HEAD_SHA).toBe('${{ inputs.head-sha }}')
    expect(step?.env?.CHECK_NAMES).toBe('${{ inputs.check-names }}')
    expect(step?.run).toContain('run.sh')
  })
})

describe('act event fixtures', () => {
  test('cover the draft, ready, edit, and re-draft transitions', () => {
    const draft = loadJson('docs/examples/events/draft-synchronize.json')
    expect(draft.action).toBe('synchronize')
    expect((draft.pull_request as { draft: boolean }).draft).toBe(true)

    const ready = loadJson('docs/examples/events/ready-for-review.json')
    expect(ready.action).toBe('ready_for_review')
    expect((ready.pull_request as { draft: boolean }).draft).toBe(false)

    const edited = loadJson('docs/examples/events/ready-edited.json')
    expect(edited.action).toBe('edited')
    expect((edited.pull_request as { draft: boolean }).draft).toBe(false)

    const converted = loadJson('docs/examples/events/converted-to-draft.json')
    expect(converted.action).toBe('converted_to_draft')
    expect((converted.pull_request as { draft: boolean }).draft).toBe(true)
  })
})
