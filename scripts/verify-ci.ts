#!/usr/bin/env bun
/* eslint-disable no-console -- this is an operator-facing verification command. */
import { join } from 'node:path'

/*
 * Local-first CI verification.
 *
 * This command never talks to GitHub Actions. It runs the fast static workflow
 * contract tests, then asks `act` to parse the reference workflows against
 * ready-for-review event fixtures when `act` is installed. It does not claim
 * that `act` reproduces hosted billing, runner image pulls, token permissions,
 * or every event semantic; `docs/ci.mdx` records those limits.
 */

const root = join(import.meta.dir, '..')

/**
 * Run a command in the repository root and inherit its output.
 * @param command Command and arguments.
 * @param label Human-readable step name.
 * @returns The process exit code.
 */
function run(command: string[], label: string): number {
  console.log(`\n==> ${label}`)
  const result = Bun.spawnSync(command, {
    cwd: root,
    stderr: 'inherit',
    stdout: 'inherit',
  })
  return result.exitCode ?? 1
}

const contract = run([process.execPath, 'test', './.github/ci'], 'Static workflow contract tests')
if (contract !== 0) process.exit(contract)

const act = Bun.which('act')
if (!act) {
  console.log(
    '\nact is not installed; the static contract tests passed.\n' +
      'Install nektos/act to parse the reference workflows locally, then re-run `bun run ci:verify`.',
  )
} else {
  const common = [
    '--dryrun',
    '--local-repository',
    `TroyAlford/basis@main=${root}`,
    '-P',
    'ubuntu-latest=catthehacker/ubuntu:act-latest',
    '--var',
    'CI_RUNNER=ubuntu-latest',
    '--eventpath',
    'docs/examples/events/ready-for-review.json',
  ]
  const ci = run(
    [act, 'pull_request', '--workflows', 'docs/examples/consumer-ci.yml', ...common],
    'act dry-run: reference consumer CI',
  )
  if (ci !== 0) process.exit(ci)

  const title = run(
    [act, 'pull_request_target', '--workflows', 'docs/examples/consumer-pr-title.yml', ...common],
    'act dry-run: reference title workflow',
  )
  if (title !== 0) process.exit(title)

  const release = [
    '--dryrun',
    '--local-repository',
    `TroyAlford/basis@main=${root}`,
    '-P',
    'ubuntu-latest=catthehacker/ubuntu:act-latest',
    '--workflows',
    '.github/workflows/release.yml',
  ]
  const releaseCall = run(
    [act, 'workflow_call', ...release, '--input', 'runs-on=ubuntu-latest'],
    'act dry-run: reusable release workflow',
  )
  if (releaseCall !== 0) process.exit(releaseCall)

  const releasePush = run(
    [act, 'push', ...release],
    'act dry-run: release on main push',
  )
  if (releasePush !== 0) process.exit(releasePush)
}

console.log(`
No hosted GitHub Actions run was triggered.

Run the repository's real checks locally before pushing:
  bun run lint
  bun run lint:ts
  bun test
  bun run test:consumer

For the snapshot runtime on its own:
  bun test libraries/testing/matchScreenshot.test.tsx
`)
