/**
 * Consumer-facing preload for browser-backed visual tests.
 *
 * Add `basis/testing/bun` to the `[test] preload` list in `bunfig.toml`; it
 * registers happy-dom, the run-scoped application fixture teardown, and the
 * shared browser lifecycle (closing the browser after the run).
 */
export * from '../libraries/testing/bun'
