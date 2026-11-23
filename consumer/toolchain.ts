import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APPROVED_BUN_SERVER_PACKAGE } from './bun-version'

/** The exact npm version used by the canonical mise toolchain. */
const TOOL_VERSION = APPROVED_BUN_SERVER_PACKAGE.replace('bun@', '')

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
  if (version !== TOOL_VERSION) {
    return `[basis] mise.toml must pin "npm:bun" version = ${JSON.stringify(TOOL_VERSION)}; ` +
      `found ${JSON.stringify(version)}.`
  }

  return null
}
