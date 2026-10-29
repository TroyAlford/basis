import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from './Server'
import { containsInternalStateSegment, isInternalStatePath, serveMount } from './StaticMount'

/**
 * Build a static root containing public content and private Basis state.
 * @returns The static root.
 */
async function fixture(): Promise<string> {
  const directory = tempDirectory('basis-static-')
  await mkdir(join(directory, '.basis', 'database'), { recursive: true })
  await writeFile(join(directory, '.basis', 'database', 'password'), 'secret')
  await writeFile(join(directory, 'public.txt'), 'ok')
  await symlink(join(directory, '.basis', 'database'), join(directory, 'credentials'), 'dir')
  return directory
}

describe('internal state protection', () => {
  test('recognizes .basis segments regardless of encoding or case', () => {
    expect(isInternalStatePath('.basis/database/password')).toBe(true)
    expect(isInternalStatePath('%2Ebasis/database/password')).toBe(true)
    expect(isInternalStatePath('.BASIS/database/password')).toBe(true)
    expect(isInternalStatePath('nested/.basis/database/password')).toBe(true)
    expect(isInternalStatePath('public/file.txt')).toBe(false)
    expect(containsInternalStateSegment('/srv/app/.basis/database/password')).toBe(true)
    expect(containsInternalStateSegment('/srv/app/public.txt')).toBe(false)
  })

  test('static mounts never serve .basis state', async () => {
    const directory = await fixture()
    const mount = { allow: null, folder: directory, prefix: '/static' }

    const secret = await serveMount(mount, '/static/.basis/database/password')
    expect(secret?.status).toBe(404)

    const alias = await serveMount(mount, '/static/credentials/password')
    expect(alias?.status).toBe(404)

    const publicFile = await serveMount(mount, '/static/public.txt')
    expect(publicFile?.status).toBe(200)

    // Mounting the internal directory directly must not expose its contents.
    const privateMount = { allow: null, folder: join(directory, '.basis'), prefix: '/secret' }
    const privateFile = await serveMount(privateMount, '/secret/database/password')
    expect(privateFile?.status).toBe(404)
  })

  test('assets never serve .basis state', async () => {
    const directory = await fixture()
    const server = new Server().assets(directory)

    for (const route of [
      '/assets/.basis/database/password',
      '/assets/%2Ebasis/database/password',
      '/assets/.BASIS/database/password',
      '/assets/credentials/password',
    ]) {
      const response = await server.handle(new Request(`http://localhost${route}`))
      expect(response?.status).toBe(404)
    }

    const publicFile = await server.handle(new Request('http://localhost/assets/public.txt'))
    expect(publicFile?.status).toBe(307)

    // Pointing the asset root at the internal directory must not expose it.
    const privateAssets = new Server().assets(join(directory, '.basis'))
    const privateFile = await privateAssets.handle(new Request('http://localhost/assets/database/password'))
    expect(privateFile?.status).toBe(404)
  })
})
