/* eslint-disable @basis/no-default-export */
import type { Linter } from 'eslint'
import basisConfig from '../libraries/eslint-plugin'
import { createComplianceConfig as buildComplianceConfig } from '../libraries/eslint-plugin/compliance'

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

/**
 * Builds the focused architectural-compliance ESLint configuration.
 *
 * This uses the same `@basis/component-architecture` rule the full Basis policy
 * runs, so `basis compliance` reports one policy rather than a second,
 * competing check. Append repository-specific exclusions through `overrides`
 * when a path is intentionally outside the architecture contract.
 * @param options Additional flat-config entries.
 * @returns A flat ESLint configuration array.
 */
export const createComplianceConfig = (options: CreateConfigOptions = {}): Linter.Config[] => {
  const { overrides = [] } = options
  return [...buildComplianceConfig(), ...overrides]
}

export default createConfig()
