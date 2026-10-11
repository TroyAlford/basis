import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IconBase } from '../../react/icons/IconBase/IconBase'
import { Path } from '../../react/icons/parts/Path'
import type { IconOptions } from './Favicon'
import { discoverFavicon, faviconContentType, faviconResponse, iconResponse, renderIcon, resolveFavicon, resolveIcon } from './Favicon'

/** A minimal icon used to exercise standalone rendering. */
class TestIcon extends IconBase {
  static displayName = 'TestIcon'
  renderContent = () => <Path d="M-50 -50H50V50H-50Z" fill={this.props.filled} />
}

const tempDirs: string[] = []

/**
 * Create a temporary directory tracked for cleanup.
 * @returns The directory path.
 */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'basis-favicon-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('faviconContentType', () => {
  test('maps known extensions and falls back for unknown ones', () => {
    expect(faviconContentType('ico')).toBe('image/x-icon')
    expect(faviconContentType('SVG')).toBe('image/svg+xml')
    expect(faviconContentType('png')).toBe('image/png')
    expect(faviconContentType('bmp')).toBe('application/octet-stream')
  })
})

describe('discoverFavicon', () => {
  test('prefers the working directory, then the root, then extension order', async () => {
    const cwd = await tempDir()
    const root = await tempDir()
    await Bun.write(join(root, 'favicon.ico'), 'root-ico')
    await Bun.write(join(cwd, 'favicon.png'), 'cwd-png')
    await Bun.write(join(cwd, 'favicon.svg'), 'cwd-svg')

    // cwd wins outright; svg is probed before png.
    expect(discoverFavicon(cwd, root)).toEqual({ extension: 'svg', path: join(cwd, 'favicon.svg') })
  })

  test('falls through to the root when the working directory has none', async () => {
    const cwd = await tempDir()
    const root = await tempDir()
    await Bun.write(join(root, 'favicon.ico'), 'root-ico')

    expect(discoverFavicon(cwd, root)).toEqual({ extension: 'ico', path: join(root, 'favicon.ico') })
  })

  test('returns null when neither directory has a favicon', async () => {
    expect(discoverFavicon(await tempDir(), await tempDir())).toBeNull()
  })
})

describe('resolveIcon', () => {
  test('prefers the app registry, then the Basis set, and misses otherwise', () => {
    const app = { TestIcon }

    expect(resolveIcon('TestIcon', app)).toBe(TestIcon)
    expect(resolveIcon('Remove', app)).not.toBeNull()
    expect(resolveIcon('NotAnIcon', app)).toBeNull()
  })
})

describe('renderIcon', () => {
  test('resolves color, size defaults, and the filled flag', () => {
    const outline = renderIcon(TestIcon, {})
    expect(outline).toContain('stroke="#000000"')
    expect(outline).toContain('width="1em"')
    expect(outline).toContain('height="1em"')
    expect(outline).toContain('fill="transparent"')
  })

  test('accepts a hex color with a leading hash and a filled icon', () => {
    const filled = renderIcon(TestIcon, { color: '#ff0000', filled: 'true', size: '32' })

    expect(filled).toContain('stroke="#ff0000"')
    expect(filled).toContain('fill="#ff0000"')
    expect(filled).toContain('width="32"')
  })

  test('ignores the stroke override', () => {
    expect(renderIcon(TestIcon, { stroke: '99' })).not.toContain('stroke="99"')
  })
})

describe('resolveFavicon', () => {
  test('resolves an IconBase to the standard URL', () => {
    const resolved = resolveFavicon(TestIcon, { color: 'ff0000', filled: true }, '/cwd', '/root')

    expect(resolved).toMatchObject({
      href: '/assets/favicon',
      kind: 'icon',
      path: '/assets/favicon',
      type: 'image/svg+xml',
    })
  })

  test('resolves a path relative to the root', () => {
    expect(resolveFavicon('./brand.png', {}, '/cwd', '/root')).toMatchObject({
      file: '/root/brand.png',
      href: '/assets/favicon',
      kind: 'file',
      type: 'image/png',
    })
  })

  test('resolves a file blob by its name', () => {
    const resolved = resolveFavicon(Bun.file('/tmp/icon.svg'), {}, '/cwd', '/root')

    expect(resolved).toMatchObject({ href: '/assets/favicon', kind: 'file', type: 'image/svg+xml' })
  })

  test('discovers a favicon when none is configured', async () => {
    const root = await tempDir()
    await Bun.write(join(root, 'favicon.ico'), 'ico')

    expect(resolveFavicon(null, {}, await tempDir(), root)).toMatchObject({
      file: join(root, 'favicon.ico'),
      href: '/assets/favicon',
      kind: 'file',
    })
  })

  test('discovers a favicon in an extra directory such as an assets mount', async () => {
    const assets = await tempDir()
    await Bun.write(join(assets, 'favicon.svg'), '<svg/>')

    expect(resolveFavicon(null, {}, await tempDir(), await tempDir(), [assets])).toMatchObject({
      file: join(assets, 'favicon.svg'),
      href: '/assets/favicon',
      kind: 'file',
      type: 'image/svg+xml',
    })
  })

  test('defaults to the Basis mark when nothing is configured or discovered', async () => {
    expect(resolveFavicon(null, {}, await tempDir(), await tempDir())).toMatchObject({
      href: '/assets/favicon',
      kind: 'icon',
      type: 'image/svg+xml',
    })
  })
})

describe('faviconResponse', () => {
  test('serves a discovered file with its content type', async () => {
    const root = await tempDir()
    await Bun.write(join(root, 'favicon.ico'), 'ico-bytes')
    const favicon = resolveFavicon(null, {}, await tempDir(), root)

    const response = await faviconResponse(favicon, new URLSearchParams())
    expect(response?.headers.get('content-type')).toBe('image/x-icon')
    expect(await response?.text()).toBe('ico-bytes')
  })

  test('serves an icon, letting the request query override configured options', () => {
    const response = iconResponse(TestIcon, { color: '00ff00' } as IconOptions, new URLSearchParams('color=0000ff'))
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
  })

  test('serves the Basis mark by default', async () => {
    const favicon = resolveFavicon(null, {}, await tempDir(), await tempDir())
    const response = await faviconResponse(favicon, new URLSearchParams())

    expect(response?.headers.get('content-type')).toBe('image/svg+xml')
    expect(await response?.text()).toContain('<svg')
  })
})
