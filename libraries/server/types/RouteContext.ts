import type { ILogger } from '../../utilities'

/**
 * Context passed to an API, SSE, or socket route handler.
 *
 * The handler receives the request it is serving and the server's standard
 * {@link ILogger}, so route output shares the same format and platform context
 * as server lifecycle output.
 */
export interface RouteContext {
  /** The server's standard logger. */
  readonly logger: ILogger,
  /** The incoming request. */
  readonly request: Request,
}
