import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBasisPatches, findInstalledInstances, loadBasisPatches } from './install'

const FOOT_PATCH = `${[
  'diff --git a/index.js b/index.js',
  '--- a/index.js',
  '+++ b/index.js',
  '@@ -1 +1 @@',
  '-module.exports = 1',
  '+module.exports = 42',
].join('\n')}\n`

const UNPATCHED = 'module.exports = 1\n'
const PATCHED = 'module.exports = 42\n'

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), 'basis-patches-'))

const makePackage = (root: string, relativePath: string, name: string, version: string): string => {
  const dir = join(root, relativePath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  return dir
}

const makeBasis = (root: string): string => {
  const basis = join(root, 'basis')
  const patches = join(basis, 'patches')
  mkdirSync(patches, { recursive: true })
  writeFileSync(join(patches, 'foo@1.0.0.patch'), FOOT_PATCH)
  writeFileSync(
    join(basis, 'package.json'),
    JSON.stringify({ name: 'basis', patchedDependencies: { 'foo@1.0.0': 'patches/foo@1.0.0.patch' } }),
  )
  return basis
}

describe('loadBasisPatches', () => {
  test('derives exact package versions from patchedDependencies', () => {
    const root = makeTempDir()
    const basis = makeBasis(root)
    expect(loadBasisPatches(basis)).toEqual([
      { name: 'foo', path: join(basis, 'patches', 'foo@1.0.0.patch'), version: '1.0.0' },
    ])
  })
})

describe('findInstalledInstances', () => {
  test('finds hoisted, scoped and nested copies', () => {
    const root = makeTempDir()
    makePackage(root, 'node_modules/foo', 'foo', '1.0.0')
    makePackage(root, 'node_modules/@scope/bar', '@scope/bar', '2.0.0')
    makePackage(root, 'node_modules/consumer/node_modules/foo', 'foo', '1.0.0')

    expect(findInstalledInstances(root, 'foo')).toHaveLength(2)
    expect(findInstalledInstances(root, '@scope/bar')).toHaveLength(1)
  })
})

describe('applyBasisPatches', () => {
  const prepare = (): { basis: string, root: string } => {
    const root = makeTempDir()
    const basis = makeBasis(root)
    const target = makePackage(root, 'node_modules/foo', 'foo', '1.0.0')
    writeFileSync(join(target, 'index.js'), UNPATCHED)
    return { basis, root }
  }

  test('applies the exact-version patch through git and is idempotent', () => {
    const { basis, root } = prepare()

    expect(applyBasisPatches({ basisDir: basis, rootDir: root })).toEqual({
      applied: ['foo@1.0.0'],
      skipped: [],
    })
    expect(readFileSync(join(root, 'node_modules/foo/index.js'), 'utf8')).toBe(PATCHED)

    expect(applyBasisPatches({ basisDir: basis, rootDir: root })).toEqual({
      applied: [],
      skipped: ['foo@1.0.0'],
    })
  })

  test('patches every exact-version copy and leaves other versions untouched', () => {
    const { basis, root } = prepare()
    const nested = makePackage(root, 'node_modules/other/node_modules/foo', 'foo', '1.0.0')
    const other = makePackage(root, 'node_modules/other/node_modules/foo-old', 'foo', '2.0.0')
    writeFileSync(join(nested, 'index.js'), UNPATCHED)
    writeFileSync(join(other, 'index.js'), UNPATCHED)

    applyBasisPatches({ basisDir: basis, rootDir: root })

    expect(readFileSync(join(root, 'node_modules/foo/index.js'), 'utf8')).toBe(PATCHED)
    expect(readFileSync(join(nested, 'index.js'), 'utf8')).toBe(PATCHED)
    expect(readFileSync(join(other, 'index.js'), 'utf8')).toBe(UNPATCHED)
  })

  test('plans without writing when write is false', () => {
    const { basis, root } = prepare()

    expect(applyBasisPatches({ basisDir: basis, rootDir: root, write: false })).toEqual({
      applied: ['foo@1.0.0'],
      skipped: [],
    })
    expect(readFileSync(join(root, 'node_modules/foo/index.js'), 'utf8')).toBe(UNPATCHED)
  })

  test('throws when the expected exact version is absent', () => {
    const root = makeTempDir()
    const basis = makeBasis(root)
    makePackage(root, 'node_modules/foo', 'foo', '2.0.0')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/no installed copy/)
  })

  test('throws loudly when the patch no longer matches', () => {
    const { basis, root } = prepare()
    writeFileSync(join(root, 'node_modules/foo/index.js'), 'module.exports = 99\n')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/no longer applies/)
  })
})
