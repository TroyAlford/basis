/**
 * Consumer-facing entrypoint for the Basis testing surface.
 *
 * Re-exports browser-backed visual helpers (Playwright screenshots, snapshot
 * comparison, and the `matchScreenshot` helper) so a consumer can
 * `import { ... } from 'basis/testing'` without reaching into Basis workspace
 * paths.
 */
export * from '../libraries/testing'
