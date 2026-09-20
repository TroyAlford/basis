/* eslint-disable @import/no-default-export */
import type { Linter } from 'eslint'
import basisConfig from '../libraries/eslint-plugin'

/**
 * Options accepted by {@link createConfig}.
 */
interface CreateConfigOptions {
  /** Extra flat-config entries appended after the Basis policy. */
  overrides?: Linter.Config[],
  /** Consumer tsconfig the import resolver should use. Defaults to `./tsconfig.json`. */
  tsconfig?: string,
}

/**
 * Builds the Basis flat ESLint configuration for a consumer project.
 *
 * The default export is the zero-argument form, so a consumer can use
 * `export { default } from 'basis/eslint'`. Call this factory when the project
 * needs to point the import resolver at a non-default tsconfig or append local
 * overrides.
 * @param options Resolver and override configuration.
 * @returns A flat ESLint configuration array.
 */
export const createConfig = (options: CreateConfigOptions = {}): Linter.Config[] => {
  const { overrides = [], tsconfig = './tsconfig.json' } = options

  return [
    ...(basisConfig as unknown as Linter.Config[]),
    {
      settings: {
        '@import/resolver': {
          typescript: {
            alwaysTryTypes: true,
            project: tsconfig,
          },
        },
      },
    },
    ...overrides,
  ]
}

export default createConfig()
