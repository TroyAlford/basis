import type { CommandResult } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { CommandRunner } from './containers'
import { reapDeadOwners, reapInstallRoots } from './containers'
import { tempDirectory, tempRoot } from './tempDirectory'

/** One fake container in the runner's Docker state. */
interface FakeContainer {
  /** Container id. */
  readonly id: string,
  /** Installation label value, when present. */
  readonly install?: string,
  /** Owner pid label value, when present. */
  readonly owner?: string,
}

/** One fake volume in the runner's Docker state. */
interface FakeVolume {
  /** Installation label value, when present. */
  readonly install?: string,
  /** Volume name. */
  readonly name: string,
}

/** Fake Docker state plus the commands the reaper issued. */
interface FakeDocker {
  /** Every command issued, including the leading `docker`. */
  readonly calls: string[][],
  /** Containers the fake daemon reports. */
  readonly containers: readonly FakeContainer[],
  /** Volumes the fake daemon reports. */
  readonly volumes: readonly FakeVolume[],
}

/**
 * Build a successful Docker result.
 * @param lines - Output lines.
 * @returns The captured result.
 */
function result(lines: string[] = []): CommandResult {
  return { exitCode: 0, lines, stderr: '', stdout: lines.join('\n') }
}

/**
 * Build a runner that answers the reaper's listing commands from fake state.
 * @param state - Fake Docker state; records every issued command.
 * @returns The injectable runner.
 */
function runnerFor(state: FakeDocker): CommandRunner {
  return (command, args) => {
    state.calls.push([command, ...args])
    const filterAt = args.indexOf('--filter')
    const filter = filterAt >= 0 ? args[filterAt + 1] : ''
    if (args[0] === 'ps' && filter === 'label=basis.test=1') {
      return result(state.containers
        .filter(container => container.owner !== undefined)
        .map(container => `${container.id}\t${container.owner}`))
    }
    if (args[0] === 'ps' && filter === 'label=basis.install') {
      return result(state.containers
        .filter(container => container.install !== undefined)
        .map(container => `${container.id}\t${container.install}`))
    }
    if (args[0] === 'volume' && args[1] === 'ls') {
      return result(state.volumes
        .filter(volume => volume.install !== undefined)
        .map(volume => `${volume.name}\t${volume.install}`))
    }
    return result()
  }
}

/**
 * Collect the removal commands a fake runner recorded.
 * @param calls - Commands issued to the fake runner.
 * @returns Removal argv arrays.
 */
function removals(calls: readonly string[][]): string[][] {
  return calls.filter(call => call[1] === 'rm' || (call[1] === 'volume' && call[2] === 'rm'))
}

describe('testing/containers reaper', () => {
  test('removes managed resources installed under the project temp root', () => {
    const install = tempDirectory('basis-context-owned-')
    const state: FakeDocker = {
      calls: [],
      containers: [{ id: 'owned-container', install }],
      volumes: [{ install, name: 'owned-volume' }],
    }

    reapInstallRoots([tempRoot()], runnerFor(state))

    expect(removals(state.calls)).toEqual([
      ['docker', 'rm', '-f', '-v', 'owned-container'],
      ['docker', 'volume', 'rm', '-f', 'owned-volume'],
    ])
  })

  test('leaves another project and a stable checkout alone', () => {
    const other = join(import.meta.dir, 'foreign-checkout')
    const stable = join(import.meta.dir, 'stable-checkout')
    const state: FakeDocker = {
      calls: [],
      containers: [
        { id: 'foreign-container', install: other },
        { id: 'stable-container', install: stable },
      ],
      volumes: [
        { install: other, name: 'foreign-volume' },
        { install: stable, name: 'stable-volume' },
      ],
    }

    reapInstallRoots([tempRoot()], runnerFor(state))

    expect(removals(state.calls)).toEqual([])
  })

  test('removes test containers whose owner process is gone', () => {
    const dead = 2_147_483_647
    const state: FakeDocker = {
      calls: [],
      containers: [
        { id: 'dead-owner', owner: String(dead) },
        { id: 'live-owner', owner: String(process.pid) },
      ],
      volumes: [],
    }

    reapDeadOwners(runnerFor(state))

    expect(removals(state.calls)).toEqual([
      ['docker', 'rm', '-f', '-v', 'dead-owner'],
    ])
  })
})
