import type { HttpVerb } from '../../utilities'
import type { RouteContext } from './RouteContext'

/** An API route. */
export interface APIRoute<Params extends object = object> {
  /** The handler for the API route. */
  handler: (params: Params, context: RouteContext) => Response | Promise<Response>,
  /** The HTTP methods to handle. */
  verbs: Set<HttpVerb>,
}
