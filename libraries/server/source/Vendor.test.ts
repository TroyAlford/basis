import { tempDirectory, useApplication, waitFor } from 'basis/testing'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RawSourceMap } from 'source-map-js'
import { SourceMapConsumer } from 'source-map-js'
import { pluginMarkdown, pluginSASS } from '../../bun-plugins'
import type { VendorAsset, VendorBuild } from './Vendor'
import { buildVendor, buildVendorBundle, discoverVendorSpecifiers } from './Vendor'

setDefaultTimeout(30_000)

const repoRoot = join(import.meta.dir, '..', '..', '..')
const fixture = join(repoRoot, 'testing', 'server', 'vendor.ts')

/**
 * Write vendor entry modules into a temporary project.
 * @param root - The temporary project root.
 * @param entries - Entry names and sources.
 * @returns A promise that resolves when the entries are written.
 */
async function writeEntries(root: string, entries: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(join(root, 'vendor'), { recursive: true })
  await Promise.all(Object.entries(entries).map(([name, source]) => (
    writeFile(join(root, 'vendor', `${name}.ts`), source)
  )))
}

/**
 * Read one built artifact that the test requires.
 * @param build - The vendor build result.
 * @param name - The chunk name.
 * @returns The artifact.
 */
function artifact(build: VendorBuild, name: string): VendorAsset {
  const found = build.byName[name]
  if (!found) throw new Error(`missing vendor chunk: ${name}`)
  return found
}

interface ActiveVendorSnapshot {
  bytes: string,
  hash: string,
  mapBytes: string,
  mapHash: string,
  mapUrl: string,
  url: string,
}

/**
 * Resolve the running server's active vendor script and source map through their
 * unversioned redirects, then read their immutable bytes.
 * @param base - The application origin.
 * @returns The active snapshot metadata and bytes.
 */
async function activeVendorSnapshot(base: string): Promise<ActiveVendorSnapshot> {
  const html = await Bun.fetch(base).then(response => response.text())
  const source = /<script[^>]+src="([^"]*vendor[^"]*)"/.exec(html)?.[1]
  if (!source) throw new Error('missing vendor script')
  const vendorRedirect = await Bun.fetch(new URL(source, base), { redirect: 'manual' })
  const location = vendorRedirect.headers.get('location')
  if (!location) throw new Error('missing vendor redirect location')
  const url = new URL(location, base).toString()
  const hash = new URL(url).searchParams.get('v')
  if (!hash) throw new Error('missing vendor hash')

  const mapRedirect = await Bun.fetch(new URL('/assets/vendor/vendor.js.map', base), {
    redirect: 'manual',
  })
  const mapLocation = mapRedirect.headers.get('location')
  if (!mapLocation) throw new Error('missing vendor map redirect location')
  const mapUrl = new URL(mapLocation, base).toString()
  const mapHash = new URL(mapUrl).searchParams.get('v')
  if (!mapHash) throw new Error('missing vendor map hash')

  const bytes = await Bun.fetch(url).then(response => response.text())
  const mapBytes = await Bun.fetch(mapUrl).then(response => response.text())
  return { bytes, hash, mapBytes, mapHash, mapUrl, url }
}

describe('vendor assets', () => {
  test('builds deterministic, isolated, content-versioned artifacts', async () => {
    const root = tempDirectory('basis-vendor-build-')

    try {
      await writeEntries(root, {
        alpha: 'globalThis.Alpha = "one"\n',
        beta: 'globalThis.Beta = "stable"\n',
        consumer: 'import { value } from "shared"\nglobalThis.Consumer = value\n',
      })
      const options = {
        entries: [
          { entrypoint: 'vendor/alpha.ts', name: 'alpha' },
          { entrypoint: 'vendor/beta.ts', name: 'beta' },
          { entrypoint: 'vendor/consumer.ts', globals: { shared: 'window.Shared' }, name: 'consumer' },
        ],
        root,
      }

      const first = await buildVendor(options)
      const second = await buildVendor(options)

      expect(first.assets.map(asset => asset.name)).toEqual(['alpha', 'beta', 'consumer'])
      for (const asset of first.assets) {
        const bytes = new Uint8Array(await Bun.file(asset.file).arrayBuffer())
        const rebuilt = artifact(second, asset.name)

        expect(asset.hash).toBe(createHash('sha256').update(bytes).digest('hex'))
        expect(asset.bytes).toBe(bytes.byteLength)
        expect(asset.url).toBe(`/assets/vendor/${asset.name}.js?v=${asset.hash}`)
        expect(rebuilt?.hash).toBe(asset.hash)
        expect(new Uint8Array(await Bun.file(rebuilt.file).arrayBuffer())).toEqual(bytes)

        expect(asset.sourceMap).toBeDefined()
        const sourceMap = asset.sourceMap
        if (!sourceMap) throw new Error(`missing source map for ${asset.name}`)
        const map = JSON.parse(await Bun.file(sourceMap.file).text()) as RawSourceMap
        expect(map.sourcesContent).toBeDefined()
        const consumer = new SourceMapConsumer(map)
        const sources = new Set<string>()
        consumer.eachMapping(mapping => {
          if (mapping.source) sources.add(mapping.source)
        })
        expect([...sources].some(source => source.includes(`${asset.name}.ts`))).toBe(true)
      }

      expect(await Bun.file(artifact(second, 'consumer').file).text()).toContain('window.Shared')

      const consumer = await Bun.file(artifact(second, 'consumer').file).text()
      const previousConsumer = (globalThis as Record<string, unknown>).Consumer
      try {
        new Function('window', consumer)({ Shared: { value: 'shared' } })
        expect((globalThis as Record<string, unknown>).Consumer).toBe('shared')
      } finally {
        if (previousConsumer === undefined) delete (globalThis as Record<string, unknown>).Consumer
        else (globalThis as Record<string, unknown>).Consumer = previousConsumer
      }
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('discovers the client graph and builds the standard automatic bundle', async () => {
    const root = tempDirectory('basis-vendor-discovery-')

    try {
      const specifiers = await discoverVendorSpecifiers({
        entrypoint: join(repoRoot, 'testing', 'server', 'Application.tsx'),
        plugins: [pluginSASS(), pluginMarkdown()],
        root: repoRoot,
      })

      expect(specifiers).toContain('react')
      expect(specifiers).not.toContain('pg')
      await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir')

      const build = await buildVendorBundle({ root, specifiers })
      const vendor = artifact(build, 'vendor')
      expect(vendor.url).toMatch(/^\/assets\/vendor\/vendor\.js\?v=[a-f0-9]{64}$/)
      expect(vendor.sourceMap).toBeDefined()
      expect(await Bun.file(vendor.file).text()).toContain('__basisVendor')
      expect(await Bun.file(vendor.file).text()).toContain('sourceMappingURL=vendor.js.map')
      const map = await Bun.file(vendor.sourceMap?.file ?? '').text()
      expect(map).toContain('vendor-entry.ts')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('wires the discovered vendor bundle into a Server application automatically', async () => {
    const application = await useApplication({
      cwd: repoRoot,
      entry: join(repoRoot, 'testing', 'server', 'serve.ts'),
    })

    const shell = await Bun.fetch(`${application.url}/__basis_shell`).then(response => response.text())
    expect(shell).toContain('<!-- VENDORS -->')

    const html = await Bun.fetch(`${application.url}/`).then(response => response.text())
    expect(html).toContain('<script src="/assets/vendor/vendor.js"></script>')
    expect(html).not.toContain('document.write')

    const source = /<script type="module"[^>]+src="([^"]+)"/.exec(html)?.[1]
    expect(source).toBeDefined()
    const applicationBundle = await Bun.fetch(`${application.url}${source}`).then(response => response.text())
    expect(applicationBundle).toContain('__basisVendor')
    expect(applicationBundle).not.toContain('react.production')

    const vendor = await Bun.fetch(`${application.url}/assets/vendor/vendor.js`, { redirect: 'manual' })
    expect(vendor.status).toBe(307)
    expect(vendor.headers.get('location')).toContain('?v=')
  })

  test('preserves vendor HTTP cache headers and standalone chunk identity', async () => {
    const root = tempDirectory('basis-vendor-http-')

    try {
      await writeEntries(root, {
        alpha: 'globalThis.Alpha = "one"\n',
        beta: 'globalThis.Beta = "stable"\n',
        consumer: 'import { value } from "shared"\nglobalThis.Consumer = value\n',
      })
      const options = {
        entries: [
          { entrypoint: 'vendor/alpha.ts', name: 'alpha' },
          { entrypoint: 'vendor/beta.ts', name: 'beta' },
          { entrypoint: 'vendor/consumer.ts', globals: { shared: 'window.Shared' }, name: 'consumer' },
        ],
        root,
      }
      const initial = await buildVendor(options)
      const alpha = artifact(initial, 'alpha')
      const beta = artifact(initial, 'beta')
      const alphaMap = alpha.sourceMap
      if (!alphaMap) throw new Error('missing alpha source map')
      await mkdir(join(root, 'dist', 'vendor', '.basis'), { recursive: true })
      await writeFile(join(root, 'dist', 'vendor', '.basis', 'secret'), 'secret')

      const application = await useApplication({
        cwd: repoRoot,
        entry: fixture,
        env: { APP_ROOT: root },
      })

      expect((await Bun.fetch(`${application.url}/assets/vendor/.basis/secret`)).status).toBe(404)

      const response = await Bun.fetch(`${application.url}${alpha.url}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('one')
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('etag')).toBe(`"${alpha.hash}"`)

      const notModified = await Bun.fetch(`${application.url}${alpha.url}`, {
        headers: { 'If-None-Match': `"${alpha.hash}"` },
      })
      expect(notModified.status).toBe(304)
      expect(notModified.headers.get('etag')).toBe(`"${alpha.hash}"`)

      const redirect = await Bun.fetch(`${application.url}/assets/vendor/alpha.js`, {
        redirect: 'manual',
      })
      expect(redirect.status).toBe(307)
      expect(redirect.headers.get('cache-control')).toBe('no-cache')
      expect(redirect.headers.get('location')).toContain(`?v=${alpha.hash}`)

      const mapRedirect = await Bun.fetch(`${application.url}/assets/vendor/alpha.js.map`, {
        redirect: 'manual',
      })
      expect(mapRedirect.status).toBe(307)
      expect(mapRedirect.headers.get('location')).toContain(`?v=${alphaMap.hash}`)

      const mapResponse = await Bun.fetch(`${application.url}${alphaMap.url}`)
      expect(mapResponse.status).toBe(200)
      expect(await mapResponse.text()).toContain('sourcesContent')

      await application.stop()

      /*
       * The standalone builder may rewrite files after the server has stopped.
       * A running Server's active snapshot is covered by the immutable-snapshot
       * test below.
       */
      const rebuilt = await buildVendor(options)
      expect(artifact(rebuilt, 'alpha').hash).toBe(alpha.hash)
      expect(artifact(rebuilt, 'beta').hash).toBe(beta.hash)

      await writeEntries(root, { alpha: 'globalThis.Alpha = "two"\n' })
      const changed = await buildVendor(options)
      expect(artifact(changed, 'alpha').hash).not.toBe(alpha.hash)
      expect(artifact(changed, 'beta').hash).toBe(beta.hash)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('keeps the vendor artifact fixed until the server restarts', async () => {
    const root = tempDirectory('basis-vendor-restart-')
    const modules = join(root, 'node_modules')
    const probe = join(modules, 'vendor-probe')

    await mkdir(probe, { recursive: true })
    for (const name of await readdir(join(repoRoot, 'node_modules'))) {
      if (name === '.bin' || name === 'vendor-probe') continue
      await symlink(join(repoRoot, 'node_modules', name), join(modules, name), 'dir')
    }
    await writeFile(join(probe, 'package.json'), JSON.stringify({
      main: 'index.js',
      name: 'vendor-probe',
      type: 'module',
    }))
    await writeFile(join(probe, 'index.js'), 'export const probe = "one"\n')
    await writeFile(join(root, 'bunfig.toml'), '[serve.static]\nplugins = ["basis/serve"]\n')
    await writeFile(join(root, 'serve.ts'), `
import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}

new Server().root(import.meta.dir).main('./Application.tsx').start()
    `.trim())
    await writeFile(join(root, 'Application.tsx'), `
import { Component } from ${JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))}
import { probe } from 'vendor-probe'

export class Application extends Component {
  content() {
    return <div id="probe">{probe}</div>
  }
}
    `.trim())

    const readVendor = async (url: string): Promise<string> => {
      const html = await Bun.fetch(url).then(response => response.text())
      const source = /<script[^>]+src="([^"]*vendor[^"]*)"/.exec(html)?.[1]
      if (!source) throw new Error(`missing vendor script: ${html.slice(0, 2000)}`)
      return Bun.fetch(new URL(source, url)).then(response => response.text())
    }

    let firstHash: string | undefined
    try {
      const first = await useApplication({
        cwd: root,
        entry: './serve.ts',
        env: { VENDOR_PHASE: 'first' },
        readyPath: '/',
      })
      try {
        expect(await Bun.fetch(first.url).then(response => response.text())).toContain('one')
        const snapshot = await activeVendorSnapshot(first.url)
        firstHash = snapshot.hash
        expect(snapshot.bytes).toContain('one')
        expect(snapshot.mapBytes).toContain('sourcesContent')

        /*
         * Replace the files at the same paths while the server is running. The
         * active URL must continue to identify the bytes activated at startup,
         * not the replacement now sitting on disk.
         */
        await writeFile(join(root, 'dist', 'vendor', 'vendor.js'), 'globalThis.__replacement = true\n')
        await writeFile(
          join(root, 'dist', 'vendor', 'vendor.js.map'),
          JSON.stringify({ mappings: '', names: [], sources: ['replacement.ts'], version: 3 }),
        )

        const oldVendor = await Bun.fetch(snapshot.url, { redirect: 'manual' })
        expect(oldVendor.status).toBe(200)
        const oldBytes = await oldVendor.text()
        expect(oldBytes).toContain('one')
        expect(oldBytes).not.toContain('__replacement')
        expect(await Bun.fetch(snapshot.url).then(response => response.text())).toBe(oldBytes)

        const oldMap = await Bun.fetch(snapshot.mapUrl, { redirect: 'manual' })
        expect(oldMap.status).toBe(200)
        expect(await oldMap.text()).toBe(snapshot.mapBytes)

        const oldRedirect = await Bun.fetch(new URL('/assets/vendor/vendor.js', first.url), {
          redirect: 'manual',
        })
        expect(oldRedirect.status).toBe(307)
        expect(oldRedirect.headers.get('location')).toContain(`?v=${snapshot.hash}`)

        const stale = await Bun.fetch(`${first.url}/assets/vendor/vendor.js?v=stale`, {
          redirect: 'manual',
        })
        expect(stale.status).toBe(307)
        expect(stale.headers.get('location')).toContain(`?v=${snapshot.hash}`)

        await writeFile(join(probe, 'index.js'), 'export const probe = "two"\n')
        expect(await readVendor(first.url)).toContain('one')
      } finally {
        await first.stop()
      }

      const second = await useApplication({
        cwd: root,
        entry: './serve.ts',
        env: { VENDOR_PHASE: 'second' },
        readyPath: '/',
      })
      try {
        expect(await Bun.fetch(second.url).then(response => response.text())).toContain('two')
        const snapshot = await activeVendorSnapshot(second.url)
        expect(snapshot.bytes).toContain('two')
        expect(snapshot.hash).not.toBe(firstHash)
      } finally {
        await second.stop()
      }
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  }, 120_000)
  test('fails production readiness but preserves development fallback when vendor discovery fails', async () => {
    const root = tempDirectory('basis-vendor-failure-')
    await writeFile(join(root, 'bunfig.toml'), '[serve.static]\nplugins = ["basis/serve"]\n')
    await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    await writeFile(join(root, 'serve.ts'), `
const realBuild = Bun.build
let builds = 0
Bun.build = ((options) => {
  builds += 1
  if (builds === 1) return Promise.reject(new Error('injected vendor failure'))
  return realBuild(options)
}) as typeof Bun.build

import { Server } from ${JSON.stringify(join(repoRoot, 'libraries', 'server', 'source', 'Server.ts'))}
import { Logger } from ${JSON.stringify(join(repoRoot, 'libraries', 'utilities', 'index.ts'))}

const logger = new Logger({ logFilePath: ${JSON.stringify(join(root, 'server.log'))} })
new Server().root(import.meta.dir).main('./Application.tsx').start({ logger })
    `.trim())
    await writeFile(join(root, 'Application.tsx'), `
import { Component } from ${JSON.stringify(join(repoRoot, 'libraries', 'react', 'index.ts'))}

export class Application extends Component {
  componentDidMount() {
    super.componentDidMount()
    globalThis.__basisFallbackHydrated = true
  }
  content() {
    return <h1>Vendor fallback</h1>
  }
}
    `.trim())

    try {
      const production = await useApplication({
        cwd: root,
        development: false,
        entry: './serve.ts',
        readyStatus: status => status === 503,
        timeoutMs: 10_000,
      })
      try {
        const health = await waitFor(async () => {
          const response = await Bun.fetch(`${production.url}/api/health`)
          const body = await response.json() as { error?: string, status?: string }
          return body.status === 'error' ? body : null
        }, { timeout: 10_000 })
        expect(health.error).toContain('injected vendor failure')
      } finally {
        await production.stop()
      }

      const development = await useApplication({
        cwd: root,
        development: true,
        entry: './serve.ts',
      })
      try {
        await development.visit('/', async page => {
          await page.waitForSelector('h1')
          await page.waitForFunction(
            () => (globalThis as { __basisFallbackHydrated?: boolean }).__basisFallbackHydrated === true,
          )
          expect(await page.textContent('h1')).toBe('Vendor fallback')
        })
        expect(readFileSync(join(root, 'server.log'), 'utf8'))
          .toContain('client vendor discovery failed: injected vendor failure')
      } finally {
        await development.stop()
      }
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
