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
   * Basis ships as TypeScript source, so a downstream compile pulls imported
   * Basis `.ts` files into the consumer program. Basis source is not yet
   * strict-clean, so the exported preset pins `strict: false` and
   * `noImplicitOverride: false` (matching the monorepo) rather than forcing
   * those errors from Basis source onto consumers. The other flipped TS 6
   * defaults are pinned explicitly.
   */
  test('pins the pre-TS6 defaults and keeps the consumer experience working', () => {
    expect(preset.compilerOptions?.strict).toBe(false)
    expect(preset.compilerOptions?.noImplicitOverride).toBe(false)
    expect(preset.compilerOptions?.noUncheckedSideEffectImports).toBe(false)
    expect(preset.compilerOptions?.types).toEqual(['*'])
    expect(preset.compilerOptions?.libReplacement).toBe(true)
  })
})
