import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The subset of the exported preset needed for the assertions below. */
interface Preset {
  /** The preset's compiler options. */
  compilerOptions?: Record<string, unknown>,
}

const preset = JSON.parse(readFileSync(join(import.meta.dir, 'base.json'), 'utf8')) as Preset

describe('basis/tsconfig/base.json', () => {
  /*
   * TypeScript 6 flipped several compiler defaults. The exported preset must
   * pin the pre-TS6 values explicitly, so a consumer extending it does not
   * silently change type-checking policy as part of the compiler upgrade.
   */
  test('pins the pre-TS6 defaults that TS 6/7 flipped', () => {
    expect(preset.compilerOptions?.strict).toBe(false)
    expect(preset.compilerOptions?.noUncheckedSideEffectImports).toBe(false)
    expect(preset.compilerOptions?.types).toEqual(['*'])
    expect(preset.compilerOptions?.libReplacement).toBe(true)
  })
})
