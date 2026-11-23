import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { supportsBasisServerToolchain } from './bun-version'

/**
 * Explain an unsupported consumer toolchain configuration.
 *
 * Basis consumers must use one canonical `mise.toml` with the npm Bun backend
 * and the approved platform-aware package. A legacy `.tool-versions` or an
 * incomplete mise file would select a different runtime than CI and the
 * installer contract.
 * @param root - The consumer project root.
 * @returns The actionable failure, or null when the toolchain is canonical.
 */
export function consumerToolchainUnsupportedReason(root: string): string | null {
  const legacy = join(root, '.tool-versions')
  if (existsSync(legacy)) {
    return `[basis] consumer toolchain must use mise.toml, not ${legacy}; ` +
      'remove .tool-versions and install Bun through the documented npm mise backend.'
  }

  const config = join(root, 'mise.toml')
  if (!existsSync(config)) {
    return `[basis] consumer toolchain requires ${config}. Add the documented npm Bun toolchain ` +
      '(see docs/installation.mdx) so Basis installs and runs under the supported runtime.'
  }

  let parsed: unknown
  try {
    parsed = Bun.TOML.parse(readFileSync(config, 'utf8'))
  } catch {
    return `[basis] ${config} is not valid TOML; use the documented npm Bun toolchain.`
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return `[basis] ${config} must contain a [tools] "npm:bun" entry.`
  }

  const record = parsed as {
    settings?: { npm?: { package_manager?: unknown } },
    tools?: Record<string, unknown>,
  }
  const packageManager = record.settings?.npm?.package_manager
  if (packageManager !== 'npm') {
    return '[basis] mise.toml must set [settings] npm.package_manager = "npm" ' +
      'so Bun platform packages and postinstall are installed.'
  }

  const bun = record.tools?.['npm:bun']
  if (typeof bun !== 'object' || bun === null) {
    return '[basis] mise.toml must define [tools] "npm:bun" with the approved canary version.'
  }
  const version = (bun as { version?: unknown }).version
  if (typeof version !== 'string' || !supportsBasisServerToolchain(version)) {
    return '[basis] mise.toml must pin "npm:bun" to the approved canary or a stable Bun >= 1.4.6; ' +
      `found ${JSON.stringify(version)}.`
  }

  const allowBuilds = (bun as { allow_builds?: unknown }).allow_builds
  if (allowBuilds !== true) {
    return '[basis] mise.toml "npm:bun" must set allow_builds = true so Bun postinstall can run.'
  }

  const npmArgs = (bun as { npm_args?: unknown }).npm_args
  if (
    typeof npmArgs !== 'string'
    || !npmArgs.includes('--include=optional')
    || !npmArgs.includes('--ignore-scripts=false')
  ) {
    return '[basis] mise.toml "npm:bun" must set npm_args to include ' +
      '"--include=optional --ignore-scripts=false".'
  }

  return null
}
