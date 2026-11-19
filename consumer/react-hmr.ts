/**
 * Consumer-facing entrypoint for Basis's production component HMR runtime.
 *
 * The production HMR plugin injects `basis/react/hmr` into component modules so
 * class components keep a stable identity across module replacement. The
 * generated hydration entry also uses {@link attachRoot} to receive updates.
 */
export { attachRoot, register } from '../libraries/react/hmr'
