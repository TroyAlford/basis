/* eslint-disable @basis/no-default-export */
import type { Linter } from 'eslint'
import basisConfig from '../libraries/eslint-plugin'

/**
 * Options accepted by {@link createConfig}.
 */
interface CreateConfigOptions {
  /** Extra flat-config entries appended after the Basis policy. */
  overrides?: Linter.Config[],
}

/**
 * Builds the Basis flat ESLint configuration for a consumer project.
 *
 * The default export is the zero-argument form, so a consumer can use
 * `export { default } from 'basis/eslint'`. Call this factory only to append
 * repository-specific overrides.
 * @param options Additional flat-config entries.
 * @returns A flat ESLint configuration array.
 */
export const createConfig = (options: CreateConfigOptions = {}): Linter.Config[] => {
  const { overrides = [] } = options
  return [...(basisConfig as unknown as Linter.Config[]), ...overrides]
}

export default createConfig()
