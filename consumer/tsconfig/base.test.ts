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
   * The exported preset keeps its deliberate `strict: true` policy while pinning
   * the other pre-TS6 values that TS 6/7 flipped, so a consumer extending it
   * does not silently change type-checking policy.
   */
  test('keeps the strict policy and pins the TS6 compatibility defaults', () => {
    expect(preset.compilerOptions?.strict).toBe(true)
    expect(preset.compilerOptions?.noUncheckedSideEffectImports).toBe(false)
    expect(preset.compilerOptions?.types).toEqual(['*'])
    expect(preset.compilerOptions?.libReplacement).toBe(true)
  })
})
