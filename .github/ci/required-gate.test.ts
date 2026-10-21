/* eslint-disable camelcase -- GitHub's check-run API uses snake_case keys. */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Exercise the real reducer script against a fake `gh` on PATH.
 *
 * Every test owns a temporary bin directory, a fake `gh`, and a JSON page
 * response. No test touches GitHub or Docker, and each case is fast enough to
 * run on every local `bun test` invocation.
 */

const GATE = fileURLToPath(new URL('../actions/required-gate/run.sh', import.meta.url))
const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567'

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_CALLS"

if [[ -n "\${FAKE_SEQUENCE:-}" ]]; then
  counter_file="\${FAKE_CALLS}.counter"
  n=0
  if [[ -f "$counter_file" ]]; then
    n="$(cat "$counter_file")"
  fi
  n=$((n + 1))
  printf '%s' "$n" > "$counter_file"
  sed -n "\${n}p" "$FAKE_SEQUENCE"
else
  cat "$FAKE_PAGES"
fi
`

interface GateOptions {
  checkNames?: Record<string, string>,
  headSha?: string,
  needs: Record<string, { result?: string }>,
  pages?: unknown[],
  runId?: string,
  sequence?: unknown[][],
  timeoutSeconds?: number,
}

interface GateResult {
  calls: string,
  exitCode: number,
  stderr: string,
  stdout: string,
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/**
 * Build a completed or in-flight check run.
 * @param name Check-run name.
 * @param conclusion Conclusion, or null for an in-flight check.
 * @param extras Additional fields.
 * @returns A check-run object.
 */
function check(name: string, conclusion: string | null, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    completed_at: conclusion === null ? null : '2026-10-21T12:00:00Z',
    conclusion,
    details_url: 'https://github.com/example/repo/actions/runs/999/job/1',
    name,
    status: conclusion === null ? 'in_progress' : 'completed',
    ...extras,
  }
}

/**
 * Run the reducer with a controlled check-run API.
 * @param options Scenario inputs.
 * @returns The process result and the fake `gh` call log.
 */
async function runGate(options: GateOptions): Promise<GateResult> {
  const directory = await mkdtemp(join(tmpdir(), 'basis-required-gate-'))
  directories.push(directory)

  const bin = join(directory, 'bin')
  await mkdir(bin)
  const gh = join(bin, 'gh')
  await writeFile(gh, FAKE_GH)
  await chmod(gh, 0o755)

  const calls = join(directory, 'calls.log')
  const pages = join(directory, 'pages.json')
  await writeFile(pages, JSON.stringify(options.pages ?? []))

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CHECK_NAMES: JSON.stringify(options.checkNames ?? {}),
    FAKE_CALLS: calls,
    FAKE_PAGES: pages,
    GH_TOKEN: 'test-token',
    HEAD_SHA: options.headSha ?? HEAD_SHA,
    NEEDS: JSON.stringify(options.needs),
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    REPO: 'example/repo',
    REUSE_POLL_SECONDS: '0.05',
    REUSE_TIMEOUT_SECONDS: String(options.timeoutSeconds ?? 5),
    RUN_ID: options.runId ?? '123',
  }

  if (options.sequence) {
    const sequence = join(directory, 'sequence.jsonl')
    await writeFile(sequence, options.sequence.map(page => JSON.stringify(page)).join('\n'))
    env.FAKE_SEQUENCE = sequence
  }

  const child = Bun.spawnSync(['bash', GATE], { env, stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  return {
    calls: existsSync(calls) ? await readFile(calls, 'utf8') : '',
    exitCode: child.exitCode ?? -1,
    stderr: decoder.decode(child.stderr),
    stdout: decoder.decode(child.stdout),
  }
}

describe('required gate result reduction', () => {
  test('passes when every dependency succeeded in this run', async () => {
    const result = await runGate({
      needs: { quality: { result: 'success' }, test: { result: 'success' } },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('All required jobs passed')
  })

  test('fails a failing dependency', async () => {
    const result = await runGate({
      needs: { quality: { result: 'failure' }, test: { result: 'success' } },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('required jobs did not pass: quality')
  })

  test('fails a cancelled dependency', async () => {
    const result = await runGate({ needs: { test: { result: 'cancelled' } } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('required jobs did not pass: test')
  })

  test('fails a timed-out dependency', async () => {
    const result = await runGate({ needs: { test: { result: 'timed_out' } } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('required jobs did not pass: test')
  })

  test('fails a dependency with no result at all', async () => {
    const result = await runGate({ needs: { test: {} } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('required jobs did not pass: test')
  })

  test('rejects an empty dependency set', async () => {
    const result = await runGate({ needs: {} })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('at least one job')
  })
})

describe('required gate skip reuse', () => {
  test('reuses a successful check for a skipped dependency', async () => {
    const result = await runGate({
      needs: { quality: { result: 'success' }, test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', 'success')] }],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('reusing a successful test check')
  })

  test('fails when the skipped dependency has no prior result', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [] }],
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('missing')
  })

  test('fails when the prior result was neutral', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', 'neutral')] }],
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('neutral')
  })

  test('fails when the prior result was skipped', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', 'skipped')] }],
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('missing')
  })

  test('fails when the prior result was a failure', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', 'failure')] }],
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('failure')
  })

  test("does not reuse this run's own completed result", async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{
        check_runs: [check('test', 'success', {
          details_url: 'https://github.com/example/repo/actions/runs/123/job/1',
        })],
      }],
      runId: '123',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('missing')
  })

  test('maps a job id to its check-run name', async () => {
    const result = await runGate({
      checkNames: { quality: 'Quality' },
      needs: { quality: { result: 'skipped' } },
      pages: [{ check_runs: [check('Quality', 'success')] }],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('reusing a successful Quality check')
  })

  test('queries the exact head SHA', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', 'success')] }],
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toContain(`commits/${HEAD_SHA}/check-runs`)
  })

  test('waits for an in-flight check, then reuses it', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      sequence: [
        [{ check_runs: [check('test', null)] }],
        [{ check_runs: [check('test', 'success')] }],
        [{ check_runs: [check('test', 'success')] }],
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('waiting for an in-flight test check')
    expect(result.calls.trim().split('\n').length).toBeGreaterThanOrEqual(2)
  })

  test('fails when an in-flight check does not finish before the timeout', async () => {
    const result = await runGate({
      needs: { test: { result: 'skipped' } },
      pages: [{ check_runs: [check('test', null)] }],
      timeoutSeconds: 0,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('still in flight')
  })
})
