import { afterAll } from 'bun:test'
import { stopApplications } from './application'
import { closeRuntime, getBrowser } from './browser'
import { pruneSnapshots } from './cleanup'
import { cleanupRun } from './lifecycle'
import { cleanupTempDirectories, isolateTempDirectories } from './tempDirectory'

import './happydom'
import '../react/testing/bun/register'

/*
 * Isolate the process temp directory before the suite runs, so every test — and
 * every dependency or spawned child — writes inside one run-scoped root that is
 * removed when the run ends.
 */
isolateTempDirectories()

/* Warm the run-scoped browser during preload when an integration lane opts in. */
if (Bun.env.BASIS_SNAPSHOT_PRELOAD === '1') void getBrowser().catch(() => undefined)

afterAll(() => { pruneSnapshots() })
afterAll(cleanupRun)
afterAll(stopApplications)
afterAll(closeRuntime)
afterAll(cleanupTempDirectories)

/**
 * Stop run-scoped application servers and the snapshot runtime, remove the
 * run-scoped temp root, then exit, when the run is interrupted.
 * @param code - The exit code to report after teardown.
 */
const onSignal = (code: number): void => {
  void Promise.allSettled([cleanupRun(), stopApplications(), closeRuntime()])
    .finally(() => {
      cleanupTempDirectories()
      process.exit(code)
    })
}

process.once('SIGINT', () => onSignal(130))
process.once('SIGTERM', () => onSignal(143))
