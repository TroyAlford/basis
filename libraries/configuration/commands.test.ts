import { describe, expect, test } from 'bun:test'
import { Logger } from '../utilities'
import { checkCommands, requireCommands } from './commands'

/** A logger that stays quiet in tests. */
const silent = new Logger({ silent: true })

/**
 * A resolver that only finds the named commands.
 * @param available - Command names that resolve.
 * @returns A resolver returning a path for the named commands, else `null`.
 */
function resolveOnly(available: readonly string[]): (command: string) => string | null {
  return command => (available.includes(command) ? `/usr/bin/${command}` : null)
}

describe('checkCommands', () => {
  test('splits resolved commands from missing ones', () => {
    const result = checkCommands(['docker', 'op'], { resolve: resolveOnly(['docker']) })

    expect(result.resolved.map(({ command }) => command)).toEqual(['docker'])
    expect(result.missing.map(({ command }) => command)).toEqual(['op'])
  })

  test('never throws when a command is missing', () => {
    expect(() => checkCommands(['nope'], { resolve: () => null })).not.toThrow()
  })
})

describe('requireCommands', () => {
  test('returns every command when all resolve', () => {
    const resolved = requireCommands(['docker', 'op'], { logger: silent, resolve: () => '/usr/bin/x' })

    expect(resolved.map(({ command }) => command)).toEqual(['docker', 'op'])
  })

  test('fails loudly naming every missing peer dependency', () => {
    const resolve = (command: string): string | null => (command === 'docker' ? '/usr/bin/docker' : null)

    expect(() => requireCommands(['docker', 'op'], { logger: silent, resolve })).toThrow(/op/)
  })

  test('uses the declared human name in the failure message', () => {
    expect(() => requireCommands([{ command: 'lego', name: 'ACME client' }], { logger: silent, resolve: () => null }))
      .toThrow(/ACME client/)
  })
})
