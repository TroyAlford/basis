/**
 * Consumer-facing preload for browser-backed visual tests.
 *
 * Add `basis/testing/bun` to the `[test] preload` list in `bunfig.toml`; it
 * registers the `toMatchScreenshot` matcher and closes the shared browser after
 * the run.
 */
export * from '../libraries/testing/bun'
