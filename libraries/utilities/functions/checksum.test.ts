import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksum } from './checksum'

describe('checksum', () => {
  test('hashes raw strings and bytes with SHA-256', () => {
    expect(checksum('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(checksum(new TextEncoder().encode('hello')))
      .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  test('uses stable structured ordering by default', () => {
    expect(checksum({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(checksum({ a: 1, b: { c: 2, d: 3 } }))
  })

  test('can preserve insertion-order serialization for legacy byte layouts', () => {
    const first = Object.fromEntries([['a', 1], ['b', 2]])
    const second = Object.fromEntries([['b', 2], ['a', 1]])
    expect(checksum(first, { stable: false })).not.toBe(checksum(second, { stable: false }))
  })

  test('hashes a large file through the native file overload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'basis-checksum-'))
    const path = join(root, 'archive.dump')
    const bytes = new Uint8Array(2 * 1024 * 1024)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    try {
      await writeFile(path, bytes)
      expect(await checksum(Bun.file(path))).toBe(checksum(bytes))
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('propagates native file checksum errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'basis-checksum-'))
    try {
      await expect(checksum(Bun.file(join(root, 'missing.dump'))))
        .rejects.toThrow(/failed for missing\.dump/)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
