import { tempDirectory, useApplication } from 'basis/testing'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VendorAsset, VendorBuild } from './Vendor'
import { buildVendor } from './Vendor'

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
        outdir: 'dist/vendor',
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
      }

      expect(await Bun.file(artifact(second, 'consumer').file).text()).toContain('window.Shared')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('reuses unchanged cache entries and invalidates changed chunks over HTTP', async () => {
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
        outdir: 'dist/vendor',
        root,
      }
      const initial = await buildVendor(options)
      const alpha = artifact(initial, 'alpha')
      const beta = artifact(initial, 'beta')
      await mkdir(join(root, 'dist', 'vendor', '.basis'), { recursive: true })
      await writeFile(join(root, 'dist', 'vendor', '.basis', 'secret'), 'secret')

      const application = await useApplication({
        cwd: repoRoot,
        entry: fixture,
        env: { VENDOR_ROOT: join(root, 'dist', 'vendor') },
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

      const rebuilt = await buildVendor(options)
      expect(artifact(rebuilt, 'alpha').hash).toBe(alpha.hash)
      expect(artifact(rebuilt, 'beta').hash).toBe(beta.hash)
      expect((await Bun.fetch(`${application.url}${artifact(rebuilt, 'alpha').url}`)).status).toBe(200)
      expect(await Bun.fetch(`${application.url}${artifact(rebuilt, 'beta').url}`).then(result => result.text()))
        .toContain('stable')

      await writeEntries(root, { alpha: 'globalThis.Alpha = "two"\n' })
      const changed = await buildVendor(options)
      expect(artifact(changed, 'alpha').hash).not.toBe(alpha.hash)
      expect(artifact(changed, 'beta').hash).toBe(beta.hash)

      const updated = await Bun.fetch(`${application.url}${artifact(changed, 'alpha').url}`)
      expect(updated.status).toBe(200)
      expect(await updated.text()).toContain('two')

      const stale = await Bun.fetch(`${application.url}${alpha.url}`, { redirect: 'manual' })
      expect(stale.status).toBe(307)
      expect(stale.headers.get('location')).toContain(`?v=${artifact(changed, 'alpha').hash}`)

      const stable = await Bun.fetch(`${application.url}${beta.url}`)
      expect(stable.status).toBe(200)
      expect(await stable.text()).toContain('stable')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
