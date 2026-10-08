import { describe, expect, test } from 'bun:test'
import type { DockerResult, DockerRunner } from './browser-container'
import { browserContainerArgs, DOCKER_HELP, playwrightImage, resolvePlaywrightPackages, resolvePlaywrightVersion, startBrowserContainer, stopBrowserContainer } from './browser-container'

/** A successful docker invocation. */
const OK: DockerResult = { exitCode: 0, stderr: '', stdout: 'container-id\n' }

/** Package directories for argv assertions. */
const PACKAGES = { coreDir: '/host/playwright-core', playwrightDir: '/host/playwright' }

/**
 * A runner that records the argv it was handed.
 * @param result - The result every invocation returns.
 * @returns The recorded calls and the runner.
 */
function recordingRunner(result: DockerResult = OK): { calls: string[][], runner: DockerRunner } {
  const calls: string[][] = []
  return {
    calls,
    runner: args => {
      calls.push([...args])
      return result
    },
  }
}

describe('playwrightImage', () => {
  test('pins the image to the Playwright version on Ubuntu Noble', () => {
    expect(playwrightImage('1.63.0')).toBe('mcr.microsoft.com/playwright:v1.63.0-noble')
  })
})

describe('resolvePlaywrightVersion', () => {
  test('resolves the installed Playwright version', () => {
    expect(resolvePlaywrightVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('resolvePlaywrightPackages', () => {
  test('resolves both installed package directories', () => {
    const packages = resolvePlaywrightPackages()

    expect(packages.playwrightDir).toContain('playwright')
    expect(packages.coreDir).toContain('playwright-core')
  })
})

describe('browserContainerArgs', () => {
  test('runs the mounted Playwright server, published on loopback', () => {
    const argv = browserContainerArgs({
      hostPort: 43210,
      image: 'mcr.microsoft.com/playwright:v1.63.0-noble',
      name: 'basis-playwright-test',
      packages: PACKAGES,
    })

    expect(argv.slice(0, 2)).toEqual(['run', '--detach'])
    expect(argv).toContain('--init')
    expect(argv).toContain('--rm')
    expect(argv).toContain('--network=host')
    expect(argv).not.toContain('--publish')
    expect(argv[argv.indexOf('--name') + 1]).toBe('basis-playwright-test')
    expect(argv[argv.indexOf('--volume') + 1]).toBe('/host/playwright:/opt/basis-playwright/node_modules/playwright:ro')
    expect(argv[argv.indexOf('--volume', argv.indexOf('--volume') + 1) + 1])
      .toBe('/host/playwright-core:/opt/basis-playwright/node_modules/playwright-core:ro')
    expect(argv).toContain('mcr.microsoft.com/playwright:v1.63.0-noble')
    // The mounted CLI runs the server on the host port; no in-container download.
    expect(argv[argv.indexOf('node') + 1]).toBe('/opt/basis-playwright/node_modules/playwright/cli.js')
    expect(argv.slice(argv.indexOf('run-server'))).toEqual([
      'run-server', '--port', '43210', '--host', '0.0.0.0',
    ])
  })
})

describe('startBrowserContainer', () => {
  test('starts the container and exposes a loopback endpoint', () => {
    const { calls, runner } = recordingRunner()
    const container = startBrowserContainer({
      hostPort: 43211,
      name: 'basis-playwright-test',
      packages: PACKAGES,
      runner,
      version: '1.63.0',
    })

    expect(container.endpoint).toBe('ws://127.0.0.1:43211/')
    expect(container.name).toBe('basis-playwright-test')
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('run')
  })

  test('stops the container by name', () => {
    const { calls, runner } = recordingRunner()
    const container = startBrowserContainer({
      hostPort: 43212,
      name: 'basis-playwright-test',
      packages: PACKAGES,
      runner,
      version: '1.63.0',
    })

    container.stop()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['rm', '--force', 'basis-playwright-test'])
  })

  test('fails loudly with remediation when the container cannot start', () => {
    const runner: DockerRunner = () => ({
      exitCode: 1,
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
      stdout: '',
    })

    expect(() => startBrowserContainer({
      hostPort: 43213,
      name: 'basis-playwright-test',
      packages: PACKAGES,
      runner,
      version: '1.63.0',
    })).toThrow(/v1\.63\.0-noble.*Cannot connect to the Docker daemon.*always runs through Docker/)
    expect(DOCKER_HELP).toContain('basis.hostDependencies')
  })
})

describe('stopBrowserContainer', () => {
  test('never masks a run result when teardown fails', () => {
    const runner: DockerRunner = () => {
      throw new Error('docker is gone')
    }

    expect(() => { stopBrowserContainer('basis-playwright-test', runner) }).not.toThrow()
  })
})
