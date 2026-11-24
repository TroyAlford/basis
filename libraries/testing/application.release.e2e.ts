/* eslint-disable @basis/no-custom-test-server, @basis/no-direct-process-spawn -- Two same-origin server lifetimes. */
/* eslint-disable @basis/no-direct-application-navigation -- The lifecycle page must own reload navigation. */
import { afterAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { reservePort } from './application'
import { withPage } from './browser'

const fixture = join(import.meta.dir, '..', '..', 'testing', 'release')
const children = new Set<ReturnType<typeof Bun.spawn>>()
const reservations = new Set<ReturnType<typeof reservePort>>()

afterAll(() => {
  for (const child of children) child.kill()
  for (const reservation of reservations) reservation.release()
})

/**
 * Reserve an ephemeral port for one same-origin server lifetime.
 * @returns The port number.
 */
function port(): number {
  const reservation = reservePort()
  reservations.add(reservation)
  return reservation.port
}

/**
 * Start the release fixture on a port and wait for its health version.
 * @param value - Port to bind.
 * @param version - Release version to serve.
 * @param delay - Readiness delay in milliseconds.
 * @param publicOrigin - Trusted public origin for vendor script URLs.
 * @returns The child process.
 */
async function start(
  value: number,
  version: string,
  delay = 0,
  publicOrigin = '',
): Promise<ReturnType<typeof Bun.spawn>> {
  const child = Bun.spawn([process.execPath, './serve.ts'], {
    cwd: fixture,
    env: {
      ...process.env,
      APP_VERSION: version,
      NODE_ENV: 'production',
      PORT: String(value),
      PUBLIC_ORIGIN: publicOrigin,
      READY_DELAY: String(delay),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  children.add(child)
  const deadline = Date.now() + 20_000
  let last = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await Bun.fetch(`http://127.0.0.1:${value}/api/health`)
      const body = await response.json() as { status?: string, version?: string }
      last = `${response.status} ${JSON.stringify(body)}`
      if (response.status === 200 && body.status === 'ok' && body.version === version) return child
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(100)
  }
  child.kill()
  const stderr = await new Response(child.stderr).text()
  const stdout = await new Response(child.stdout).text()
  throw new Error(`server ${version} did not become ready (${last})\n${stdout}\n${stderr}`)
}

/**
 * Stop a fixture process and wait for it to exit.
 * @param child - Process to stop.
 */
async function stop(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  children.delete(child)
  child.kill()
  await child.exited
}

/**
 * Wait for the release monitor to observe a page version.
 * @param page - Browser page.
 * @param version - Expected version.
 */
async function waitForVersion(page: Page, version: string): Promise<void> {
  await page.waitForFunction(
    expected => document.querySelector('[data-testid="release-version"]')?.textContent === expected,
    version,
    { timeout: 20_000 },
  )
}

test('new release replaces the document once', async () => {
  const value = port()
  const first = await start(value, 'A')
  try {
    await withPage(async page => {
      let loads = 0
      page.on('load', () => { loads += 1 })
      await page.goto(`http://127.0.0.1:${value}/`)
      await waitForVersion(page, 'A')
      await page.evaluate(() => { (globalThis as { __releaseSentinel?: string }).__releaseSentinel = 'A' })
      await stop(first)
      await start(value, 'B')
      await waitForVersion(page, 'B')
      expect(loads).toBe(2)
      expect(await page.evaluate(
        () => (globalThis as { __releaseSentinel?: string }).__releaseSentinel,
      )).toBeUndefined()
    })
  } finally {
    await stop(first).catch(() => undefined)
  }
}, 60_000)

test('same-version interruption reconnects without a document reload', async () => {
  const value = port()
  const first = await start(value, 'A')
  let second: ReturnType<typeof Bun.spawn> | null = null
  try {
    await withPage(async page => {
      let loads = 0
      page.on('load', () => { loads += 1 })
      await page.goto(`http://127.0.0.1:${value}/`)
      await waitForVersion(page, 'A')
      await page.evaluate(() => { (globalThis as { __releaseSentinel?: string }).__releaseSentinel = 'A' })
      await stop(first)
      second = await start(value, 'A')
      await Bun.sleep(6_000)
      expect(loads).toBe(1)
      expect(await page.evaluate(() => (globalThis as { __releaseSentinel?: string }).__releaseSentinel)).toBe('A')
    })
  } finally {
    await stop(second ?? first).catch(() => undefined)
  }
}, 60_000)

test('delayed readiness waits for the new release before one reload', async () => {
  const value = port()
  const first = await start(value, 'A')
  let second: ReturnType<typeof Bun.spawn> | null = null
  try {
    await withPage(async page => {
      let loads = 0
      page.on('load', () => { loads += 1 })
      await page.goto(`http://127.0.0.1:${value}/`)
      await waitForVersion(page, 'A')
      await stop(first)
      second = Bun.spawn([process.execPath, './serve.ts'], {
        cwd: fixture,
        env: { ...process.env, APP_VERSION: 'B', NODE_ENV: 'production', PORT: String(value), READY_DELAY: '1500' },
        stderr: 'pipe',
        stdout: 'pipe',
      })
      children.add(second)
      await Bun.sleep(2_500)
      expect(loads).toBe(1)
      await waitForVersion(page, 'B')
      expect(loads).toBe(2)
    })
  } finally {
    await stop(second ?? first).catch(() => undefined)
  }
}, 60_000)

test('hydrates through an HTTPS reverse proxy using the configured public origin', async () => {
  const basisPort = port()
  const proxyPort = port()
  const certificate = await Bun.file(join(fixture, '..', '..', 'config', 'tls', 'certificate.pem')).text()
  const key = await Bun.file(join(fixture, '..', '..', 'config', 'tls', 'key.pem')).text()
  const proxy = Bun.serve({
    fetch: async request => {
      const url = new URL(request.url)
      return Bun.fetch(`http://127.0.0.1:${basisPort}${url.pathname}${url.search}`, {
        body: request.body,
        headers: request.headers,
        method: request.method,
      })
    },
    hostname: '127.0.0.1',
    port: proxyPort,
    tls: { cert: certificate, key },
  })
  const child = await start(basisPort, 'A', 0, `https://localhost:${proxyPort}`)
  try {
    await withPage(async page => {
      await page.goto(`https://localhost:${proxyPort}/`)
      await waitForVersion(page, 'A')
      await page.waitForFunction(() => (globalThis as { __releaseHydrated?: boolean }).__releaseHydrated === true)
    }, { context: { ignoreHTTPSErrors: true } })
  } finally {
    await stop(child)
    proxy.stop(true)
  }
}, 60_000)
test('repeated same-version interruptions do not reload', async () => {
  const value = port()
  let current = await start(value, 'A')
  try {
    await withPage(async page => {
      let loads = 0
      page.on('load', () => { loads += 1 })
      await page.goto(`http://127.0.0.1:${value}/`)
      await waitForVersion(page, 'A')
      await page.evaluate(() => { (globalThis as { __releaseSentinel?: string }).__releaseSentinel = 'A' })
      for (let index = 0; index < 2; index += 1) {
        await stop(current)
        current = await start(value, 'A')
      }
      await Bun.sleep(6_000)
      expect(loads).toBe(1)
      expect(await page.evaluate(() => (globalThis as { __releaseSentinel?: string }).__releaseSentinel)).toBe('A')
    })
  } finally {
    await stop(current).catch(() => undefined)
  }
}, 60_000)
