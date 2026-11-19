/**
 * Internal entrypoint for the production component HMR runtime.
 *
 * The consumer surface is `basis/react/hmr`; this module keeps that subpath
 * resolvable for consumers that map `basis/*` onto the workspace library tree.
 */
export { attachRoot, register } from './runtime/Hmr'
