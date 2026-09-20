import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBasisPatches, findInstalledInstances, loadBasisPatches } from './install'

const UNPATCHED = 'module.exports = 1\n'
const PATCHED = 'module.exports = 42\n'
const REPATCHED = 'module.exports = 43\n'

const makePatch = (value: number): string => `${[
  'diff --git a/index.js b/index.js',
  '--- a/index.js',
  '+++ b/index.js',
  '@@ -1 +1 @@',
  '-module.exports = 1',
  `+module.exports = ${value}`,
].join('\n')}\n`

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), 'basis-patches-'))

const makePackage = (root: string, relativePath: string, name: string, version: string): string => {
  const dir = join(root, relativePath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  return dir
}

const makeConsumer = (root: string): void => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }))
}

const makeBasis = (root: string, patch = makePatch(42)): string => {
  const basis = join(root, 'basis')
  const patches = join(basis, 'patches')
  mkdirSync(patches, { recursive: true })
  writeFileSync(join(patches, 'foo@1.0.0.patch'), patch)
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

  test('finds the isolated .bun store and deduplicates symlinked copies', () => {
    const root = makeTempDir()
    const store = makePackage(root, 'node_modules/.bun/foo@1.0.0+abc/node_modules/foo', 'foo', '1.0.0')
    mkdirSync(join(root, 'node_modules', '.bun', 'node_modules'), { recursive: true })
    symlinkSync(store, join(root, 'node_modules', '.bun', 'node_modules', 'foo'), 'dir')

    expect(findInstalledInstances(root, 'foo')).toEqual([{ name: 'foo', path: store, version: '1.0.0' }])
  })
})

describe('applyBasisPatches', () => {
  const prepare = (): { basis: string, root: string, target: string } => {
    const root = makeTempDir()
    const basis = makeBasis(root)
    makeConsumer(root)
    const target = makePackage(root, 'node_modules/foo', 'foo', '1.0.0')
    writeFileSync(join(target, 'index.js'), UNPATCHED)
    return { basis, root, target }
  }

  test('applies the exact-version patch through git and is idempotent', () => {
    const { basis, root, target } = prepare()

    expect(applyBasisPatches({ basisDir: basis, rootDir: root })).toEqual({
      applied: ['foo@1.0.0'],
      retired: [],
      skipped: [],
    })
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(PATCHED)

    expect(applyBasisPatches({ basisDir: basis, rootDir: root })).toEqual({
      applied: [],
      retired: [],
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

  test('applies patches in the isolated .bun layout', () => {
    const { basis, root } = prepare()
    const isolated = makePackage(root, 'node_modules/.bun/foo@1.0.0+abc/node_modules/foo', 'foo', '1.0.0')
    writeFileSync(join(isolated, 'index.js'), UNPATCHED)

    applyBasisPatches({ basisDir: basis, rootDir: root })

    expect(readFileSync(join(isolated, 'index.js'), 'utf8')).toBe(PATCHED)
  })

  test('plans without writing when write is false', () => {
    const { basis, root, target } = prepare()

    expect(applyBasisPatches({ basisDir: basis, rootDir: root, write: false })).toEqual({
      applied: ['foo@1.0.0'],
      retired: [],
      skipped: [],
    })
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(UNPATCHED)
  })

  test('throws when the expected exact version is absent', () => {
    const root = makeTempDir()
    const basis = makeBasis(root)
    makeConsumer(root)
    makePackage(root, 'node_modules/foo', 'foo', '2.0.0')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/no installed copy/)
  })

  test('throws loudly when the patch no longer matches', () => {
    const { basis, root, target } = prepare()
    writeFileSync(join(target, 'index.js'), 'module.exports = 99\n')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/no longer applies/)
  })

  test('reverses a patch that a later Basis version no longer ships', () => {
    const { basis, root, target } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(PATCHED)

    writeFileSync(join(basis, 'package.json'), JSON.stringify({ name: 'basis', patchedDependencies: {} }))

    expect(applyBasisPatches({ basisDir: basis, rootDir: root })).toEqual({
      applied: [],
      retired: ['foo@1.0.0'],
      skipped: [],
    })
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(UNPATCHED)
  })

  test('reverses and re-applies a patch whose contents changed', () => {
    const { basis, root, target } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })

    writeFileSync(join(basis, 'patches', 'foo@1.0.0.patch'), makePatch(43))
    applyBasisPatches({ basisDir: basis, rootDir: root })

    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(REPATCHED)
  })

  test('forgets a retired patch whose copy is already pristine', () => {
    const { basis, root, target } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })
    writeFileSync(join(target, 'index.js'), UNPATCHED)

    writeFileSync(join(basis, 'package.json'), JSON.stringify({ name: 'basis', patchedDependencies: {} }))
    expect(applyBasisPatches({ basisDir: basis, rootDir: root }).retired).toEqual(['foo@1.0.0'])
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe(UNPATCHED)
  })

  test('keeps state when a retired patch no longer resolves', () => {
    const { basis, root, target } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })
    writeFileSync(join(target, 'index.js'), 'module.exports = 99\n')

    writeFileSync(join(basis, 'package.json'), JSON.stringify({ name: 'basis', patchedDependencies: {} }))
    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/could not resolve retired/)

    const retained = join(root, 'node_modules', '.basis', 'patches', 'foo@1.0.0.patch')
    expect(existsSync(retained)).toBe(true)
    expect(existsSync(join(root, 'node_modules', '.basis', 'patches.json'))).toBe(true)
  })

  test('keeps state when a retained patch copy is missing', () => {
    const { basis, root } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })
    rmSync(join(root, 'node_modules', '.basis', 'patches', 'foo@1.0.0.patch'))

    writeFileSync(join(basis, 'package.json'), JSON.stringify({ name: 'basis', patchedDependencies: {} }))
    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/retained patch .* is missing/)
    expect(existsSync(join(root, 'node_modules', '.basis', 'patches.json'))).toBe(true)
  })

  test('fails loudly on an unreadable patch state file', () => {
    const { basis, root } = prepare()
    applyBasisPatches({ basisDir: basis, rootDir: root })
    writeFileSync(join(root, 'node_modules', '.basis', 'patches.json'), '{ not json')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/unreadable/)
  })
})
