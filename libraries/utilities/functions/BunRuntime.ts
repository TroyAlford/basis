/** The first stable Bun release with the built-in TypeScript checker. */
export const MINIMUM_BUN_FOR_CHECK = '1.4.3'

/**
 * The first stable Bun release verified for the combined Basis Server, vendor,
 * and production HMR pipeline.
 */
export const MINIMUM_BUN_FOR_SERVER = '1.4.6'

/** The exact canary runtime revision approved for Basis Server. */
export const APPROVED_BUN_SERVER_REVISION = '1.4.6-canary.1+b15f51302'

/** The npm distribution of the approved canary runtime. */
export const APPROVED_BUN_SERVER_PACKAGE = 'bun@1.4.5-canary.20261121.1'

/** A numeric semantic version. */
export type ParsedVersion = readonly [major: number, minor: number, patch: number]

/** Version metadata reported by a Bun runtime. */
export interface BunRuntimeInfo {
  /** `Bun.revision`, when available. */
  revision?: string,
  /** `Bun.version`, for example `1.4.6` or `1.4.6-canary.1`. */
  version: string,
}

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
 * Compare two parsed versions.
 * @param left - The left version.
 * @param right - The right version.
 * @returns A negative, zero, or positive number when left is older, equal, or newer.
 */
const compareVersions = (left: ParsedVersion, right: ParsedVersion): number => {
  const [leftMajor, leftMinor, leftPatch] = left
  const [rightMajor, rightMinor, rightPatch] = right
  if (leftMajor !== rightMajor) return leftMajor - rightMajor
  if (leftMinor !== rightMinor) return leftMinor - rightMinor
  return leftPatch - rightPatch
}

/**
 * Whether a release string carries a pre-release identifier.
 * @param version - A version or revision string.
 * @returns Whether the string has a pre-release segment before build metadata.
 */
const hasPrerelease = (version: string | undefined): boolean => {
  if (version === undefined) return false
  return version.split('+')[0].includes('-')
}

/**
 * Whether a Bun version includes the built-in TypeScript checker.
 * @param version - The Bun version to test.
 * @returns Whether `bun --check` is supported.
 */
export const supportsBunCheck = (version: string): boolean => {
  const parsed = parseBunVersion(version)
  const minimum = parseBunVersion(MINIMUM_BUN_FOR_CHECK)
  if (parsed === null || minimum === null) return false
  return compareVersions(parsed, minimum) >= 0
}

/**
 * Whether a Bun runtime is compatible with Basis Server's startup pipeline.
 *
 * Stable releases at or above {@link MINIMUM_BUN_FOR_SERVER} are accepted,
 * including future stable releases with a different revision string. The one
 * approved canary is accepted by its exact revision. Every other pre-release
 * identifier is rejected rather than treated as a newer numeric version.
 * @param runtime - The runtime metadata; defaults to the running Bun.
 * @returns Whether the runtime is supported.
 */
export const supportsBasisServer = (
  runtime: BunRuntimeInfo = { revision: Bun.revision, version: Bun.version },
): boolean => {
  const version = runtime.version.trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return false
  const parsed = parseBunVersion(version)
  const minimum = parseBunVersion(MINIMUM_BUN_FOR_SERVER)
  if (parsed === null || minimum === null) return false

  if (runtime.revision === APPROVED_BUN_SERVER_REVISION && compareVersions(parsed, minimum) >= 0) {
    return true
  }

  if (hasPrerelease(version) || hasPrerelease(runtime.revision)) return false
  return compareVersions(parsed, minimum) >= 0
}

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
 * Explains why a Bun runtime cannot run Basis Server.
 * @param runtime - The runtime metadata; defaults to the running Bun.
 * @returns The actionable message, or null when the runtime is supported.
 */
export const basisServerUnsupportedReason = (
  runtime: BunRuntimeInfo = { revision: Bun.revision, version: Bun.version },
): string | null => {
  if (supportsBasisServer(runtime)) return null
  const revision = runtime.revision === undefined ? '' : ` (revision ${runtime.revision})`
  return `[basis] Basis Server requires Bun >= ${MINIMUM_BUN_FOR_SERVER} or the approved ` +
    `${APPROVED_BUN_SERVER_REVISION} canary; found ${runtime.version}${revision}. ` +
    `Install the pinned runtime with ${APPROVED_BUN_SERVER_PACKAGE} using the documented ` +
    'mise npm toolchain configuration, or run `bun upgrade` for a verified stable release.'
}

/**
 * Throws when the running Bun runtime cannot run Basis Server.
 * @param runtime - The runtime metadata; defaults to the running Bun.
 */
export const assertBasisServerCompatible = (
  runtime: BunRuntimeInfo = { revision: Bun.revision, version: Bun.version },
): void => {
  const reason = basisServerUnsupportedReason(runtime)
  if (reason !== null) throw new Error(reason)
}
