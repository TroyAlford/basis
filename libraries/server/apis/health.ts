import { formatMilliseconds, Milliseconds } from '../../utilities'

/** Application readiness as reported by the health endpoint. */
export type HealthStatus = 'error' | 'ok' | 'starting'

/** Options for the health response. */
export interface HealthOptions {
  /** Build/readiness error to report when not ready. */
  error?: string,
  /** Readiness of the application. Defaults to `ok`. */
  status?: HealthStatus,
  /** The release version to report. Defaults to `development`. */
  version?: string,
}

/**
 * Returns the managed-application health response.
 *
 * A `200` response means the application is built and ready to serve. While the
 * initial build is pending the response is `503 starting`; after a failed build
 * it is `503 error`, so a deployment verifier can never observe a healthy
 * process for an application that did not build.
 *
 * The `status` / `version` pair is the contract Alforge deployment verification
 * depends on, where `version` is the release version command-center injects as
 * `VERSION`. The exact deployed checkout is a separate `GIT_SHA`; Bun
 * diagnostics are additive and only present when ready.
 * @param options - Health response options.
 * @param options.error - The build/readiness error, when not ready.
 * @param options.status - The application readiness.
 * @param options.version - The release version to report.
 * @returns A JSON health response with the status and release version.
 */
export const health = ({
  error,
  status = 'ok',
  version = 'development',
}: HealthOptions = {}): Response => {
  if (status !== 'ok') {
    return Response.json({ error, status, version }, { status: 503 })
  }

  return Response.json({
    bun: Bun.version,
    status,
    uptime: {
      nanoseconds: Bun.nanoseconds(),
      pretty: formatMilliseconds(Bun.nanoseconds() * Milliseconds.PerNanosecond),
    },
    version,
  })
}
