import { describe, expect, spyOn, test } from 'bun:test'
import { join } from 'node:path'
import { chromiumInstallCommand, installChromium, resolvePlaywrightCli, SKIP_BROWSER_INSTALL_ENV } from './browser'

const basisDir = join(import.meta.dir, '..')

/**
 * Run a callback with the browser-install opt-out set, restoring the prior
 * environment afterwards.
 * @param callback - The body to run.
 */
function withSkipEnv(callback: () => void): void {
  const previous = process.env[SKIP_BROWSER_INSTALL_ENV]
  process.env[SKIP_BROWSER_INSTALL_ENV] = '1'
  try {
    callback()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, SKIP_BROWSER_INSTALL_ENV)
    else process.env[SKIP_BROWSER_INSTALL_ENV] = previous
  }
}

describe('basis browser install', () => {
  test('uses the pinned Basis Playwright CLI', () => {
    const cli = resolvePlaywrightCli(basisDir)
    const manifest = Bun.resolveSync('playwright/package.json', basisDir)

    expect(cli).toBe(join(manifest, '..', 'cli.js'))
    expect(cli).toContain(`${join('node_modules', 'playwright')}`)
    expect(cli.endsWith('cli.js')).toBe(true)
  })

  test('installs Chromium with its operating-system dependencies', () => {
    const command = chromiumInstallCommand(basisDir)

    expect(command[0]).toBe(process.execPath)
    expect(command[1]).toBe(resolvePlaywrightCli(basisDir))
    expect(command.slice(2)).toEqual(['install', '--with-deps', 'chromium'])
  })

  test('provisions through the pinned CLI on success', () => {
    const calls: string[][] = []
    const run = (command: string[]): number => {
      calls.push(command)
      return 0
    }

    installChromium(basisDir, { run })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(chromiumInstallCommand(basisDir))
    expect(calls[0]).toContain('--with-deps')
  })

  test('fails loudly when provisioning fails', () => {
    const run = (): number => 1

    expect(() => installChromium(basisDir, { run })).toThrow(/browser install failed/)
  })

  test('fails loudly when the runner throws', () => {
    const run = (): number => { throw new Error('spawn failed') }

    expect(() => installChromium(basisDir, { run })).toThrow(/browser install failed: spawn failed/)
  })

  test('skips provisioning when explicitly opted out', () => {
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true)
    let called = false
    const run = (): number => {
      called = true
      return 0
    }

    try {
      withSkipEnv(() => {
        expect(() => installChromium(basisDir, { run })).not.toThrow()
      })
      expect(called).toBe(false)
    } finally {
      write.mockRestore()
    }
  })
})
