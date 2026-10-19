/** The first stable Bun release with the built-in TypeScript checker. */
export const MINIMUM_BUN_FOR_CHECK = '1.4.3'

/** The first Bun release with the built-in linter. */
export const MINIMUM_BUN_FOR_LINT = '1.4.4'

/** A numeric semantic version. */
export type ParsedVersion = readonly [major: number, minor: number, patch: number]

/**
 * Parses the numeric part of a Bun version, ignoring pre-release and build metadata.
 * @param version - The version to parse, for example `1.4.3` or `1.4.4-canary.1`.
 * @returns The numeric version, or null when the value is not a version.
 */
export const parseBunVersion = (version: string): ParsedVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether a version is at least a minimum version.
 * @param version - The version to test.
 * @param minimum - The minimum accepted version.
 * @returns Whether the version meets the minimum.
 */
const supportsVersion = (version: string, minimum: string): boolean => {
  const parsed = parseBunVersion(version)
  const floor = parseBunVersion(minimum)
  if (parsed === null || floor === null) return false

  const [major, minor, patch] = parsed
  const [minimumMajor, minimumMinor, minimumPatch] = floor
  if (major !== minimumMajor) return major > minimumMajor
  if (minor !== minimumMinor) return minor > minimumMinor
  return patch >= minimumPatch
}

/**
 * Whether a Bun version includes the built-in TypeScript checker.
 * @param version - The Bun version to test.
 * @returns Whether `bun --check` is supported.
 */
export const supportsBunCheck = (version: string): boolean => (
  supportsVersion(version, MINIMUM_BUN_FOR_CHECK)
)

/**
 * Whether a Bun version includes the built-in linter.
 * @param version - The Bun version to test.
 * @returns Whether `bun lint` is supported.
 */
export const supportsBunLint = (version: string): boolean => (
  supportsVersion(version, MINIMUM_BUN_FOR_LINT)
)

/**
 * Explains why the running Bun version cannot type check through `bun --check`.
 * @param version - The Bun version to test; defaults to the running runtime.
 * @returns The actionable message, or null when the runtime is supported.
 */
export const bunCheckUnsupportedReason = (version: string = Bun.version): string | null => {
  if (supportsBunCheck(version)) return null
  return `[basis] typecheck requires Bun >= ${MINIMUM_BUN_FOR_CHECK}; found ${version}. ` +
    'Run `bun upgrade` and retry.'
}

/**
 * Explains why the running Bun version cannot lint through `bun lint`.
 * @param version - The Bun version to test; defaults to the running runtime.
 * @returns The actionable message, or null when the runtime is supported.
 */
export const bunLintUnsupportedReason = (version: string = Bun.version): string | null => {
  if (supportsBunLint(version)) return null
  return `[basis] lint requires Bun >= ${MINIMUM_BUN_FOR_LINT}; found ${version}. ` +
    'Run `bun upgrade` and retry.'
}
