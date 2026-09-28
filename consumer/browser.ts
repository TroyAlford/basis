import { dirname, join } from 'node:path'

/** Environment variable that opts out of the implicit browser provisioning. */
export const SKIP_BROWSER_INSTALL_ENV = 'BASIS_SKIP_BROWSER_INSTALL'

/** Runs a command and returns its exit code. */
export type BrowserCommandRunner = (command: string[]) => number

/** Options accepted by {@link installChromium}. */
export interface InstallChromiumOptions {
  /** Command runner. Defaults to `Bun.spawnSync`; injectable for tests. */
  run?: BrowserCommandRunner,
}

/**
 * Resolve the pinned Playwright CLI that Basis owns.
 *
 * Basis declares `playwright`, so the CLI is resolved from the installed Basis
 * dependency graph rather than from a global or consumer-installed Playwright.
 * @param basisDir - Absolute path to the installed Basis package root.
 * @returns Absolute path to the pinned Playwright CLI.
 */
export const resolvePlaywrightCli = (basisDir: string): string => {
  const manifestPath = Bun.resolveSync('playwright/package.json', basisDir)
  return join(dirname(manifestPath), 'cli.js')
}

/**
 * Build the command that provisions the complete browser runtime.
 *
 * `--with-deps` installs the operating-system dependencies Chromium needs to
 * launch, using Playwright's supported dependency-installation path for the
 * platform, so a successful install leaves browser-backed tests ready to run.
 * @param basisDir - Absolute path to the installed Basis package root.
 * @returns The argv to run.
 */
export const chromiumInstallCommand = (basisDir: string): string[] => ([
  process.execPath,
  resolvePlaywrightCli(basisDir),
  'install',
  '--with-deps',
  'chromium',
])

/**
 * Provision the complete browser runtime used by `basis/testing`.
 *
 * Downloads the pinned Chromium build and the operating-system libraries it
 * needs. The operation is idempotent, and failure is fatal: a successful Basis
 * install is expected to leave browser-backed tests ready to run. Set
 * {@link SKIP_BROWSER_INSTALL_ENV} to opt out intentionally.
 * @param basisDir - Absolute path to the installed Basis package root.
 * @param options - Injectable command runner. Tests only.
 */
export const installChromium = (basisDir: string, options: InstallChromiumOptions = {}): void => {
  if (process.env[SKIP_BROWSER_INSTALL_ENV]) {
    process.stdout.write(`[basis] skipped browser install (${SKIP_BROWSER_INSTALL_ENV})\n`)
    return
  }

  const command = chromiumInstallCommand(basisDir)
  const run = options.run ?? ((argv: string[]): number => Bun.spawnSync(argv, {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  }).exitCode)

  let exitCode: number
  try {
    exitCode = run(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[basis] browser install failed: ${message}`, { cause: error })
  }

  if (exitCode !== 0) {
    throw new Error(
      `[basis] browser install failed (exit ${exitCode}); ` +
      'run `bunx playwright install --with-deps chromium` to inspect the failure',
    )
  }
}
