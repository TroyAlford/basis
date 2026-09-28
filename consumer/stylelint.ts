/* eslint-disable @basis/no-default-export */
import { createConfig } from '../libraries/stylelint-plugin'

export { createConfig } from '../libraries/stylelint-plugin'
export type { CreateConfigOptions } from '../libraries/stylelint-plugin'

/**
 * Consumer-facing entrypoint for the Basis CSS lint surface.
 *
 * A consumer can `export { default } from 'basis/stylelint'` to adopt the
 * Basis policy for `*.styles.ts`, or call {@link createConfig} to append
 * repository-specific rule settings and overrides. Basis owns the custom
 * syntax, plugins, and rules the returned object references.
 */
export default createConfig()
