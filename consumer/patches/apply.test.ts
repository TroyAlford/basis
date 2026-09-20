import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPatchToText } from './apply'
import { applyBasisPatches, findInstalledInstances, loadBasisPatches } from './install'
import type { PatchFile } from './parse'
import { parsePatch } from './parse'

const SIMPLE_PATCH = [
  'diff --git a/lib/thing.js b/lib/thing.js',
  '--- a/lib/thing.js',
  '+++ b/lib/thing.js',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
].join('\n')

const TWO_FILE_PATCH = [
  'diff --git a/one.js b/one.js',
  '--- a/one.js',
  '+++ b/one.js',
  '@@ -1 +1 @@',
  '-export const one = 1',
  '+export const one = 10',
  'diff --git a/two.js b/two.js',
  '--- a/two.js',
  '+++ b/two.js',
  '@@ -1 +1 @@',
  '-export const two = 2',
  '+export const two = 20',
].join('\n')

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), 'basis-patches-'))

const onlyFile = (patch: string): PatchFile => {
  const [file] = parsePatch(patch)
  if (!file) throw new Error('expected a single parsed patch file')
  return file
}

const makePackage = (root: string, relative: string, name: string, version: string): string => {
  const dir = join(root, relative)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
  return dir
}

describe('parsePatch', () => {
  test('parses every file in a multi-file patch', () => {
    const files = parsePatch(TWO_FILE_PATCH)
    expect(files.map(file => file.newPath)).toEqual(['one.js', 'two.js'])
    expect(files.every(file => file.hunks.length === 1)).toBe(true)
  })
})

describe('applyPatchToText', () => {
  test('applies a hunk in place', () => {
    const result = applyPatchToText('const a = 1\nconst b = 2\nconst c = 4\n', onlyFile(SIMPLE_PATCH))
    expect(result.applied).toBe(true)
    expect(result.content).toBe('const a = 1\nconst b = 3\nconst c = 4\n')
  })

  test('is idempotent once the patched lines are already present', () => {
    const result = applyPatchToText('const a = 1\nconst b = 3\nconst c = 4\n', onlyFile(SIMPLE_PATCH))
    expect(result.applied).toBe(false)
    expect(result.content).toBe('const a = 1\nconst b = 3\nconst c = 4\n')
  })

  test('throws loudly when the source has drifted', () => {
    expect(() => applyPatchToText('completely different\n', onlyFile(SIMPLE_PATCH))).toThrow(
      /did not apply/,
    )
  })
})

describe('loadBasisPatches', () => {
  test('derives exact package versions from patchedDependencies', () => {
    const basis = makeTempDir()
    writeFileSync(
      join(basis, 'package.json'),
      JSON.stringify({
        name: 'basis',
        patchedDependencies: {
          'eslint-plugin-import@2.32.0': 'patches/import.patch',
          'eslint-plugin-sort-keys-fix@1.1.2': 'patches/sort.patch',
        },
      }),
    )

    expect(loadBasisPatches(basis)).toEqual([
      { name: 'eslint-plugin-import', patchPath: join(basis, 'patches/import.patch'), version: '2.32.0' },
      { name: 'eslint-plugin-sort-keys-fix', patchPath: join(basis, 'patches/sort.patch'), version: '1.1.2' },
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
  const makeBasis = (): string => {
    const basis = makeTempDir()
    const patches = join(basis, 'patches')
    mkdirSync(patches)
    writeFileSync(join(patches, 'foo.patch'), SIMPLE_PATCH.replaceAll('lib/thing.js', 'index.js'))
    writeFileSync(
      join(basis, 'package.json'),
      JSON.stringify({ name: 'basis', patchedDependencies: { 'foo@1.0.0': 'patches/foo.patch' } }),
    )
    return basis
  }

  test('patches every exact-version copy and leaves other versions alone', () => {
    const basis = makeBasis()
    const root = makeTempDir()
    const target = makePackage(root, 'node_modules/foo', 'foo', '1.0.0')
    const other = makePackage(root, 'node_modules/other/node_modules/foo', 'foo', '2.0.0')

    writeFileSync(join(target, 'index.js'), 'const a = 1\nconst b = 2\nconst c = 4\n')
    writeFileSync(join(other, 'index.js'), 'const a = 1\nconst b = 2\nconst c = 4\n')

    const results = applyBasisPatches({ basisDir: basis, rootDir: root })
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('applied')
    expect(readFileSync(join(target, 'index.js'), 'utf8')).toBe('const a = 1\nconst b = 3\nconst c = 4\n')
    expect(readFileSync(join(other, 'index.js'), 'utf8')).toBe('const a = 1\nconst b = 2\nconst c = 4\n')
  })

  test('throws when the expected exact version is absent', () => {
    const basis = makeBasis()
    const root = makeTempDir()
    makePackage(root, 'node_modules/foo', 'foo', '2.0.0')

    expect(() => applyBasisPatches({ basisDir: basis, rootDir: root })).toThrow(/no installed foo@1.0.0/)
  })
})
