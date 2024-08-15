import { HttpVerb } from '@basis/utilities'

export type APIRoute<Params extends object = object> = {
	handler: (params: Params) => Response,
	verbs: Set<HttpVerb>,
}
