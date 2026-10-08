import { afterAll } from 'bun:test'
import { stopApplications } from './application'
import { closeBrowser, warmBrowser } from './browser'
import { pruneSnapshots } from './cleanup'

import './happydom'
import '../react/testing/bun/register'

/*
 * Acquire the one shared browser container before the suite. Eager so a cold
 * host performs the image pull outside every test timeout, and so the main run
 * holds the container while any spawned `bun test` fixtures and `--parallel`
 * workers reuse it. Best effort: when Docker is unavailable the first capture
 * reports it.
 */
try {
  await warmBrowser()
} catch {
  // Reported by the first capture that needs the browser.
}

/*
 * Teardown runs once for the whole run: `afterAll` at preload scope runs after
 * the entire suite, not after each file. The container is released here — the
 * last process to release removes it — and any run-scoped application is
 * stopped.
 */
afterAll(() => { pruneSnapshots() })
afterAll(stopApplications)
afterAll(closeBrowser)

/**
 * Stop run-scoped application servers and the snapshot browser container, then
 * exit, when the run is interrupted.
 * @param code - The exit code to report after teardown.
 */
const onSignal = (code: number): void => {
  void Promise.allSettled([stopApplications(), closeBrowser()]).finally(() => process.exit(code))
}

process.once('SIGINT', () => onSignal(130))
process.once('SIGTERM', () => onSignal(143))
