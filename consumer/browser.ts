import { dirname, join } from 'node:path'

/** Environment variable that opts out of the implicit browser provisioning. */
export const SKIP_BROWSER_INSTALL_ENV = 'BASIS_SKIP_BROWSER_INSTALL'

/**
 * Remediation shown when the Chromium download fails.
 *
 * Basis downloads the browser binary but never installs system packages and
 * never escalates privileges, so the operating-system libraries are the
 * environment's responsibility. This names the exact commands to run.
 */
export const BROWSER_INSTALL_HELP =
  'retry the download with `bunx playwright install chromium`.\n' +
  'If Chromium then fails to launch, the host is missing its operating-system ' +
  'libraries: install them with `bunx playwright install-deps chromium` ' +
  '(as root/administrator), or use a CI image that provides them.\n' +
  'Basis deliberately does not install system packages or require sudo during install.'

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
 * Build the command that provisions the pinned Chromium browser.
 *
 * This downloads the browser binary only. The operating-system libraries
 * Chromium needs to launch are the environment's responsibility (a CI image or a
 * one-time host bootstrap); a lifecycle script must never escalate privileges or
 * invoke the system package manager. `playwright install --with-deps` is
 * therefore deliberately not used here.
 * @param basisDir - Absolute path to the installed Basis package root.
 * @returns The argv to run.
 */
export const chromiumInstallCommand = (basisDir: string): string[] => ([
  process.execPath,
  resolvePlaywrightCli(basisDir),
  'install',
  'chromium',
])

/**
 * Provision the pinned Chromium browser used by `basis/testing`.
 *
 * Downloads the browser binary. The operation is idempotent, and failure is
 * fatal: a successful Basis install is expected to leave the browser binary
 * ready. Operating-system libraries are provisioned by the environment, never
 * implicitly by this hook. Set {@link SKIP_BROWSER_INSTALL_ENV} to opt out
 * intentionally.
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
    throw new Error(
      `[basis] browser install failed: ${message}\n${BROWSER_INSTALL_HELP}`,
      { cause: error },
    )
  }

  if (exitCode !== 0) {
    throw new Error(`[basis] browser install failed (exit ${exitCode});\n${BROWSER_INSTALL_HELP}`)
  }
}
