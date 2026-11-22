/* eslint-disable @stylistic/max-len -- Embedded fixture source strings intentionally stay single-line. */
import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useApplication } from './application'
import { tempDirectory } from './tempDirectory'

const repoRoot = join(import.meta.dir, '..', '..')
const created: string[] = []

afterAll(async () => {
  for (const directory of created) await rm(directory, { force: true, recursive: true })
})

/**
 * Write one module used by the native vendor fixture.
 * @param root - Fixture root.
 * @param path - Repository-relative source path.
 * @param source - Module source.
 */
async function writeSource(root: string, path: string, source: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, path), source)
}

/**
 * Create a deterministic external application with local dependencies and a
 * normal React tree. The fixture owns no Basis vendor plugin or configuration.
 * @returns The fixture root.
 */
async function fixture(): Promise<string> {
  const root = tempDirectory('basis-native-vendor-')
  created.push(root)
  const modules = join(root, 'node_modules')
  await mkdir(modules, { recursive: true })
  for (const name of await readdir(join(repoRoot, 'node_modules'))) {
    if (name === '.bin' || name === 'live-vendor' || name === 'side-effects') continue
    await symlink(join(repoRoot, 'node_modules', name), join(modules, name), 'dir')
  }

  await mkdir(join(modules, 'live-vendor'), { recursive: true })
  await writeFile(join(modules, 'live-vendor', 'package.json'), JSON.stringify({ main: 'index.js', name: 'live-vendor', sideEffects: true, type: 'module' }))
  await writeFile(join(modules, 'live-vendor', 'index.js'), [
    'export let value = 1',
    'export function bump() { value += 1; return value }',
    'export const named = "named-live"',
    'export const vendorMarker = "vendor-stable-marker"',
    'export default "default-live"',
    '',
  ].join('\n'))

  await mkdir(join(modules, 'side-effects'), { recursive: true })
  await writeFile(join(modules, 'side-effects', 'package.json'), JSON.stringify({ main: 'index.js', name: 'side-effects', sideEffects: true, type: 'module' }))
  await writeFile(join(modules, 'side-effects', 'index.js'), [
    'globalThis.__sideEffectCount = (globalThis.__sideEffectCount ?? 0) + 1',
    'export const sideEffectValue = "side-effect-ok"',
    '',
  ].join('\n'))

  await writeSource(root, 'src/live.ts', [
    'export { value, bump } from "live-vendor"',
    'export const reexportLabel = "re-export-ok"',
    '',
  ].join('\n'))
  await writeSource(root, 'src/shared.tsx', [
    'import * as React from "react"',
    'export function Shared() { return React.createElement("span", { "data-testid": "shared" }, "shared-ok") }',
    '',
  ].join('\n'))
  await writeSource(root, 'src/second.tsx', [
    'import * as React from "react"',
    'import { named } from "live-vendor"',
    'import { Shared } from "./shared"',
    'export function Second() { return React.createElement("span", null, React.createElement(Shared), ` second-ok ${named}`) }',
    '',
  ].join('\n'))
  await writeSource(root, 'src/lazy.tsx', [
    'import * as React from "react"',
    'export const lazyValue = "lazy-ok"',
    'export function Lazy() { return React.createElement("span", { "data-testid": "lazy" }, lazyValue) }',
    '',
  ].join('\n'))
  await writeSource(root, 'src/app.tsx', [
    'import * as React from "react"',
    'import { createRoot } from "react-dom/client"',
    'import defaultLive, { named, value, bump, vendorMarker } from "live-vendor"',
    'import * as liveNamespace from "live-vendor"',
    'import "side-effects"',
    'import { sideEffectValue } from "side-effects"',
    'import { reexportLabel, value as reexportedValue, bump as reexportedBump } from "./live"',
    'import { Shared } from "./shared"',
    'import { Second } from "./second"',
    '',
    'function App() {',
    '  const [tick, setTick] = React.useState(0)',
    '  const [lazy, setLazy] = React.useState("")',
    '  globalThis.__reactVersion = React.version',
    '  return React.createElement("main", { "data-testid": "app" },',
    '    React.createElement("h1", null, `Native vendor ${value}`),',
    '    React.createElement("p", { "data-testid": "imports" }, `${defaultLive} ${named} ${liveNamespace.named}`),',
    '    React.createElement("p", { "data-testid": "side" }, `${sideEffectValue} ${globalThis.__sideEffectCount}`),',
    '    React.createElement("p", { "data-testid": "reexport" }, `${reexportLabel} ${reexportedValue}`),',
    '    React.createElement("p", { "data-testid": "vendor-marker" }, vendorMarker),',
    '    React.createElement(Shared),',
    '    React.createElement(Second),',
    '    React.createElement("button", { "data-testid": "bump", onClick: () => { bump(); reexportedBump(); setTick(tick + 1) } }, "bump"),',
    '    React.createElement("button", { "data-testid": "lazy", onClick: () => import("./lazy").then(module => setLazy(module.lazyValue)) }, "lazy"),',
    '    lazy ? React.createElement("span", { "data-testid": "lazy-result" }, lazy) : null,',
    '  )',
    '}',
    '',
    'const root = document.getElementById("root")',
    'if (!root) throw new Error("missing root")',
    'createRoot(root).render(React.createElement(App))',
    '',
  ].join('\n'))

  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./src/app.tsx"></script></body></html>')
  await writeFile(join(root, 'serve-a.ts'), `
import index from './index.html'

// eslint-disable-next-line @basis/no-custom-test-server -- Native Bun vendor diagnostic.
Bun.serve({
  development: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/': index,
    '/api/health': () => new Response('ok'),
  },
})
`.trim())

  await writeFile(join(root, 'serve-b.ts'), `
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const dist = join(import.meta.dir, 'dist')
await mkdir(dist, { recursive: true })
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, 'src', 'app.tsx'), join(import.meta.dir, 'src', 'second.tsx')],
  naming: { entry: '[name]-[hash].[ext]', chunk: 'chunk-[hash].[ext]' },
  outdir: dist,
  splitting: true,
  target: 'browser',
  format: 'esm',
})
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'))
const appOutput = build.outputs.find(output => output.kind === 'entry-point' && output.path.includes('app-'))
if (!appOutput) throw new Error('missing app entry output')
const appName = appOutput.path.split('/').pop()
const html = \`<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/\${appName}"></script></body></html>\`
const files = new Set(await readdir(dist))
// eslint-disable-next-line @basis/no-custom-test-server -- Native Bun startup splitting diagnostic.
Bun.serve({
  development: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/': () => new Response(html, { headers: { 'Content-Type': 'text/html' } }),
    '/assets/*': request => {
      const name = new URL(request.url).pathname.slice('/assets/'.length)
      if (!files.has(name)) return new Response('not found', { status: 404 })
      return new Response(Bun.file(join(dist, name)))
    },
    '/api/health': () => new Response('ok'),
  },
})
`.trim())
  return root
}

interface ChunkInfo {
  bytes: number,
  hash: string,
  markers: string[],
}

interface AssetSnapshot {
  chunks: Record<string, ChunkInfo>,
  firstInteractionMs: number,
  requests: number,
  startupMs: number,
}

/**
 * Classify a completed JavaScript response by stable content markers.
 * @param text - Response body decoded as text.
 * @returns The recognized markers.
 */
function classifyChunk(text: string): string[] {
  return [
    text.includes('react.element') ? 'react' : '',
    text.includes('vendor-stable-marker') ? 'vendor' : '',
    text.includes('side-effect-ok') ? 'side-effects' : '',
    text.includes('data-testid') ? 'app' : '',
  ].filter(Boolean)
}

/**
 * Hash the completed bytes of one response.
 * @param body - Response body bytes.
 * @returns SHA-256 hex digest.
 */
function digest(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Load the client-rendered app in a real browser. This fixture uses
 * `createRoot`, not SSR hydration, and does not claim SSR compatibility.
 * @param root - Fixture root.
 * @param entry - Server entry.
 * @param phase - Application identity phase for restart isolation.
 * @param expectedValue - Expected initial live-vendor value.
 * @param expectedLabel - Expected heading prefix.
 * @param expectedDefault - Expected default import value.
 * @param expectedNamed - Expected named/namespace import value.
 * @returns Completed browser-response observations.
 */
async function observe(root: string, entry: string, phase: string, expectedValue = 1, expectedLabel = 'Native vendor', expectedDefault = 'default-live', expectedNamed = 'named-live'): Promise<AssetSnapshot> {
  const started = performance.now()
  const app = await useApplication({
    cwd: root,
    entry,
    env: { NATIVE_PHASE: phase },
    timeoutMs: 20_000,
  })
  const startupMs = performance.now() - started
  try {
    const chunks: Record<string, ChunkInfo> = {}
    const completed: Promise<void>[] = []
    const errors: string[] = []
    let firstInteractionMs = 0
    let requests = 0
    await app.visit('/', {
      init: page => {
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
        page.on('pageerror', error => { errors.push(error.message) })
        page.on('response', response => {
          const url = response.url()
          if (!url.endsWith('.js') && !url.includes('/chunk-')) return
          completed.push((async () => {
            await response.finished()
            if (!response.ok()) return
            const body = await response.body().catch(() => null)
            if (!body) return
            const bytes = new Uint8Array(body)
            const text = new TextDecoder().decode(bytes)
            chunks[new URL(url).pathname] = {
              bytes: bytes.byteLength,
              hash: digest(bytes),
              markers: classifyChunk(text),
            }
            requests += 1
          })())
        })
      },
    }, async page => {
      await page.waitForSelector('[data-testid="app"]')
      expect(await page.textContent('h1')).toBe(`${expectedLabel} ${expectedValue}`)
      expect(await page.textContent('[data-testid="imports"]')).toBe(`${expectedDefault} ${expectedNamed} ${expectedNamed}`)
      expect(await page.textContent('[data-testid="side"]')).toBe('side-effect-ok 1')
      expect(await page.textContent('[data-testid="reexport"]')).toBe(`re-export-ok ${expectedValue}`)
      expect(await page.textContent('[data-testid="vendor-marker"]')).toBe('vendor-stable-marker')
      firstInteractionMs = performance.now() - started
      await page.click('[data-testid="bump"]')
      await Bun.sleep(500)
      process.stdout.write(`[native-vendor] post-click ${JSON.stringify({
        errors,
        h1: await page.textContent('h1'),
        reexport: await page.textContent('[data-testid="reexport"]'),
      })}\n`)
      await page.waitForFunction(
        ([expected, label]) => document.querySelector('h1')?.textContent === `${label} ${expected + 2}`,
        [expectedValue, expectedLabel] as const,
        { timeout: 5_000 },
      )
      expect(await page.textContent('[data-testid="reexport"]')).toBe(`re-export-ok ${expectedValue + 2}`)
      await page.click('[data-testid="lazy"]')
      await page.waitForFunction(() => document.querySelector('[data-testid="lazy-result"]')?.textContent === 'lazy-ok')
    })
    await Promise.all(completed)
    return { chunks, firstInteractionMs, requests, startupMs }
  } finally {
    await app.stop()
  }
}

/**
 * Get hashes of chunks carrying one marker.
 * @param snapshot - Completed response snapshot.
 * @param marker - Marker to select.
 * @returns Sorted hashes.
 */
function hashes(snapshot: AssetSnapshot, marker: string): string[] {
  return Object.values(snapshot.chunks)
    .filter(chunk => chunk.markers.includes(marker))
    .map(chunk => chunk.hash)
    .sort()
}

test('Experiment A: native Bun HTML production identity', async () => {
  const root = await fixture()
  const first = await observe(root, './serve-a.ts', 'first')
  const appSource = join(root, 'src', 'app.tsx')
  const original = await Bun.file(appSource).text()
  await writeFile(appSource, original.replace('Native vendor ${value}', 'Native vendor updated ${value}'))
  const appChanged = await observe(root, './serve-a.ts', 'app-changed', 1, 'Native vendor updated')
  await writeFile(appSource, original)
  await writeFile(join(root, 'node_modules', 'live-vendor', 'index.js'), [
    'export let value = 10',
    'export function bump() { value += 1; return value }',
    'export const named = "named-updated"',
    'export const vendorMarker = "vendor-stable-marker"',
    'export default "default-updated"',
    '',
  ].join('\n'))
  const dependencyChanged = await observe(root, './serve-a.ts', 'dependency-changed', 10, 'Native vendor', 'default-updated', 'named-updated')
  expect(first.requests).toBe(1)
  expect(Object.keys(first.chunks)).toHaveLength(1)
  expect(hashes(appChanged, 'vendor')).not.toEqual(hashes(first, 'vendor'))
  expect(hashes(appChanged, 'app')).not.toEqual(hashes(first, 'app'))
  expect(hashes(dependencyChanged, 'app')).not.toEqual(hashes(appChanged, 'app'))
  process.stdout.write(`[native-vendor] A first=${JSON.stringify(first.chunks)} app=${JSON.stringify(appChanged.chunks)} dependency=${JSON.stringify(dependencyChanged.chunks)}\n`)
}, 120_000)

test('Experiment B: native Bun startup splitting identity', async () => {
  const root = await fixture()
  const first = await observe(root, './serve-b.ts', 'first')
  const appSource = join(root, 'src', 'app.tsx')
  const original = await Bun.file(appSource).text()
  await writeFile(appSource, original.replace('Native vendor ${value}', 'Native vendor updated ${value}'))
  const appChanged = await observe(root, './serve-b.ts', 'app-changed', 1, 'Native vendor updated')
  await writeFile(appSource, original)
  await writeFile(join(root, 'node_modules', 'live-vendor', 'index.js'), [
    'export let value = 10',
    'export function bump() { value += 1; return value }',
    'export const named = "named-updated"',
    'export const vendorMarker = "vendor-stable-marker"',
    'export default "default-updated"',
    '',
  ].join('\n'))
  const dependencyChanged = await observe(root, './serve-b.ts', 'dependency-changed', 10, 'Native vendor', 'default-updated', 'named-updated')
  expect(first.requests).toBeGreaterThan(1)
  const vendorFirst = hashes(first, 'vendor')
  const vendorAfterApp = hashes(appChanged, 'vendor')
  const vendorAfterDependency = hashes(dependencyChanged, 'vendor')
  expect(vendorFirst.length).toBeGreaterThan(0)
  expect(vendorAfterApp).toEqual(vendorFirst)
  expect(vendorAfterDependency).not.toEqual(vendorAfterApp)
  expect(hashes(appChanged, 'app')).not.toEqual(hashes(first, 'app'))
  process.stdout.write(`[native-vendor] B first=${JSON.stringify(first.chunks)} app=${JSON.stringify(appChanged.chunks)} dependency=${JSON.stringify(dependencyChanged.chunks)}\n`)
}, 120_000)

test('Current Basis vendor baseline (existing managed fixture)', async () => {
  const app = await useApplication({
    cwd: repoRoot,
    entry: './testing/server/serve.ts',
    timeoutMs: 20_000,
  })
  try {
    const started = performance.now()
    const html = await Bun.fetch(app.url).then(response => response.text())
    const vendorUrl = '/assets/vendor/vendor.js'
    const vendorBytes = await Bun.fetch(new URL(vendorUrl, app.url)).then(response => response.arrayBuffer())
    const appEntry = /<script type="module"[^>]+src="([^"]+)"/.exec(html)?.[1]
    const appBytes = appEntry
      ? await Bun.fetch(new URL(appEntry, app.url)).then(response => response.arrayBuffer())
      : new ArrayBuffer(0)
    await app.visit('/', async page => {
      await page.waitForSelector('[data-testid="application"]')
    })
    process.stdout.write(`[native-vendor] Basis vendor=${vendorBytes.byteLength} app=${appBytes.byteLength} first-request=${(performance.now() - started).toFixed(1)}ms\n`)
  } finally {
    await app.stop()
  }
}, 45_000)
