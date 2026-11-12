/**
 * Verify the recorded activity of the ordinary shared-database suite.
 *
 * The suite writes one event per real fixture transition to
 * `BASIS_DATABASE_ACTIVITY_LOG`. This gate fails when the run creates more than
 * one ordinary service, starts/readies it more than once, or fails to make and
 * execute exactly one suite-level cleanup decision.
 */

import { existsSync, readFileSync } from 'node:fs'

/** One parsed activity summary. */
interface Summary {
  readonly attaches: number,
  readonly canonicals: number,
  readonly cleanups: number,
  readonly installs: readonly string[],
  readonly starts: number,
  readonly stops: number,
}

/**
 * Read and validate the fixture activity log.
 * @param path - Activity log path.
 * @returns The observed counts.
 */
function summarize(path: string): Summary {
  const lines = existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    : []
  const install = (prefix: string): string[] => lines
    .filter(line => line.startsWith(`${prefix} `))
    .map(line => line.split(' ')[2])
    .filter((value): value is string => Boolean(value))
  const installs = [...new Set([
    ...install('start'),
    ...install('attach'),
    ...install('canonical'),
    ...install('stop'),
  ])]
  return {
    attaches: install('attach').length,
    canonicals: install('canonical').length,
    cleanups: lines.filter(line => line === 'cleanup').length,
    installs,
    starts: install('start').length,
    stops: install('stop').length,
  }
}

/**
 * Count the Docker resources still owned by an installation.
 * @param kind - Docker resource kind.
 * @param install - Installation root used in the ownership label.
 * @returns The remaining resources.
 */
function remaining(kind: 'container' | 'volume', install: string): string[] {
  const args = kind === 'container'
    ? ['ps', '-aq', '--filter', `label=basis.install=${install}`]
    : ['volume', 'ls', '-q', '--filter', `label=basis.install=${install}`]
  const result = Bun.spawnSync(['docker', ...args])
  if (result.exitCode !== 0) throw new Error(`docker ${args.join(' ')} failed`)
  return result.stdout.toString().trim().split('\n').filter(Boolean)
}

const path = Bun.env.BASIS_DATABASE_ACTIVITY_LOG
if (!path) throw new Error('BASIS_DATABASE_ACTIVITY_LOG is required for the database activity gate')
if (!existsSync(path) || readFileSync(path, 'utf8').trim() === '') {
  throw new Error(`database activity log is empty: ${path}`)
}

const summary = summarize(path)
const ephemeral = Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1'
const failures: string[] = []
if (summary.installs.length !== 1) failures.push(`expected one fixture installation, saw ${summary.installs.length}`)
if (summary.starts > 1) failures.push(`ordinary suite created ${summary.starts} managed services`)
if (ephemeral && summary.starts !== 1) {
  failures.push(`ephemeral suite must create exactly one service, saw ${summary.starts}`)
}
if (ephemeral && summary.canonicals !== 1) {
  failures.push(`ephemeral suite must prepare the canonical schema once, saw ${summary.canonicals}`)
}
if (summary.cleanups !== 1) {
  failures.push(`expected one cleanup decision, saw ${summary.cleanups}`)
}
if (ephemeral && summary.stops !== 1) {
  failures.push(`ephemeral suite must stop exactly one service, saw ${summary.stops}`)
}
if (!ephemeral && summary.stops !== 0) {
  failures.push(`persistent suite must not stop its service, saw ${summary.stops}`)
}
for (const install of summary.installs) {
  const containers = remaining('container', install)
  const volumes = remaining('volume', install)
  if (ephemeral) {
    if (containers.length > 0) failures.push(`ephemeral install left ${containers.length} containers`)
    if (volumes.length > 0) failures.push(`ephemeral install left ${volumes.length} volumes`)
  } else if (containers.length !== 1) {
    failures.push(`persistent install owns ${containers.length} containers, expected one`)
  }
}

process.stdout.write(`${JSON.stringify({ ephemeral, summary })}\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`::error::${failure}\n`)
  process.exit(1)
}
