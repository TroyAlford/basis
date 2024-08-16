import { HttpVerb } from '@basis/utilities'

export interface APIRoute<Params extends object = object> {
	handler: (params: Params) => Response,
	verbs: Set<HttpVerb>,
}
