import type { ILogger } from '../../utilities'
import type { Database } from '../source/Database'

/**
 * Context passed to an API, SSE, or socket route handler.
 *
 * The handler receives the request it is serving and the server's standard
 * {@link ILogger}, so route output shares the same format and platform context
 * as server lifecycle output.
 */
export interface RouteContext<AppContext extends object = Record<string, unknown>> {
  /** The application context loaded for this request. */
  readonly context: AppContext,
  /** The request-scoped database capability, using native Bun transactions. */
  readonly db?: Database,
  /** The verified canonical User id, or null for an anonymous request. */
  readonly identity?: string | null,
  /** The server's standard logger. */
  readonly logger: ILogger,
  /** The incoming request. */
  readonly request: Request,
}
