/**
 * Immutable startup facts about the running Basis application.
 *
 * Basis Server injects these into the SPA shell it owns, so the browser can
 * bootstrap the application's standard runtime context without an extra startup
 * fetch. `SERVICE_NAME` is the platform service identity (the repository name);
 * `VERSION` is the authoritative release version and `GIT_SHA` the observed
 * deployed revision. Any value the platform did not supply is `null`.
 */
export interface BasisRuntime {
  /** Observed deployed checkout revision (`GIT_SHA`). */
  gitSha: string | null,
  /** Service identity, conventionally the repository name (`SERVICE_NAME`). */
  serviceName: string | null,
  /** Authoritative release version (`VERSION`). */
  version: string | null,
}

/** The runtime context used when the platform supplied no facts. */
export const EMPTY_BASIS_RUNTIME: BasisRuntime = Object.freeze({
  gitSha: null,
  serviceName: null,
  version: null,
})

/**
 * Serialize runtime facts for safe embedding in the SPA HTML.
 *
 * The result is JSON with `<`, `>`, `&`, and the JS line separators escaped, so
 * it can never terminate the surrounding `<script>` element or inject markup.
 * @param runtime - Runtime facts to serialize.
 * @returns The escaped JSON document.
 */
export function serializeBasisRuntime(runtime: BasisRuntime): string {
  return JSON.stringify(runtime)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Parse embedded runtime facts, tolerating missing or malformed input.
 * @param value - Raw embedded JSON, or `null` when absent.
 * @returns The parsed runtime facts, or {@link EMPTY_BASIS_RUNTIME}.
 */
export function parseBasisRuntime(value: string | null | undefined): BasisRuntime {
  if (typeof value !== 'string' || value.length === 0) return EMPTY_BASIS_RUNTIME
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return EMPTY_BASIS_RUNTIME
    }
    const record = parsed as Record<string, unknown>
    return {
      gitSha: typeof record.gitSha === 'string' ? record.gitSha : null,
      serviceName: typeof record.serviceName === 'string' ? record.serviceName : null,
      version: typeof record.version === 'string' ? record.version : null,
    }
  } catch {
    return EMPTY_BASIS_RUNTIME
  }
}
