import { dirname, join } from 'node:path'

/** Environment variable that opts out of the implicit Chromium download. */
export const SKIP_BROWSER_INSTALL_ENV = 'BASIS_SKIP_BROWSER_INSTALL'

/**
 * Download the Chromium browser used by visual snapshot tests.
 *
 * Runs the pinned Playwright CLI through Bun (its own shebang targets Node) and
 * is idempotent: Playwright skips a browser that is already installed. A failure
 * is reported but never aborts the install, so the hook cannot wedge a consumer
 * whose browser download is temporarily unavailable.
 * @param basisDir - Absolute path to the installed Basis package root.
 * @returns True when Chromium is installed or was already present.
 */
export const installChromium = (basisDir: string): boolean => {
  if (process.env[SKIP_BROWSER_INSTALL_ENV]) {
    process.stdout.write(`[basis] skipping Chromium install (${SKIP_BROWSER_INSTALL_ENV})\n`)
    return true
  }

  try {
    const manifestPath = Bun.resolveSync('playwright/package.json', basisDir)
    const cli = join(dirname(manifestPath), 'cli.js')
    const result = Bun.spawnSync([process.execPath, cli, 'install', 'chromium'], {
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })

    if (result.exitCode !== 0) {
      process.stderr.write(
        '[basis] Chromium install failed; run `bunx playwright install chromium`\n',
      )
      return false
    }

    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[basis] Chromium install skipped: ${message}\n`)
    return false
  }
}
