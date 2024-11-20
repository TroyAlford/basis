import type { HttpVerb } from '@basis/utilities'

/** An API route. */
export interface APIRoute<Params extends object = object> {
  /** The handler for the API route. */
  handler: (params: Params) => Response,
  /** The HTTP methods to handle. */
  verbs: Set<HttpVerb>,
}
