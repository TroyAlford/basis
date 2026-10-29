import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from './Server'
import { isInternalStatePath, serveMount } from './StaticMount'

/**
 * Build a static root containing public content and private Basis state.
 * @returns The static root.
 */
async function fixture(): Promise<string> {
  const directory = tempDirectory('basis-static-')
  await mkdir(join(directory, '.basis', 'database'), { recursive: true })
  await writeFile(join(directory, '.basis', 'database', 'password'), 'secret')
  await writeFile(join(directory, 'public.txt'), 'ok')
  return directory
}

describe('internal state protection', () => {
  test('recognizes .basis segments regardless of encoding or case', () => {
    expect(isInternalStatePath('.basis/database/password')).toBe(true)
    expect(isInternalStatePath('%2Ebasis/database/password')).toBe(true)
    expect(isInternalStatePath('.BASIS/database/password')).toBe(true)
    expect(isInternalStatePath('nested/.basis/database/password')).toBe(true)
    expect(isInternalStatePath('public/file.txt')).toBe(false)
  })

  test('static mounts never serve .basis state', async () => {
    const directory = await fixture()
    const mount = { allow: null, folder: directory, prefix: '/static' }

    const secret = await serveMount(mount, '/static/.basis/database/password')
    expect(secret?.status).toBe(404)

    const publicFile = await serveMount(mount, '/static/public.txt')
    expect(publicFile?.status).toBe(200)
  })

  test('assets never serve .basis state', async () => {
    const directory = await fixture()
    const server = new Server().assets(directory)

    for (const route of [
      '/assets/.basis/database/password',
      '/assets/%2Ebasis/database/password',
      '/assets/.BASIS/database/password',
    ]) {
      const response = await server.handle(new Request(`http://localhost${route}`))
      expect(response?.status).toBe(404)
    }

    const publicFile = await server.handle(new Request('http://localhost/assets/public.txt'))
    expect(publicFile?.status).toBe(307)
  })
})
