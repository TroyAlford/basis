export interface URI {
	/**
	 * Requested resource path, without the origin
	 * @example /api/foo/bar
	 * @example /assets/foo/bar
	 */
	path: string,
	/**
	 * Requested query parameters
	 * @example ?foo=bar -> { foo: 'bar' }
	 * @example ?foo=bar&baz=qux -> { foo: 'bar', baz: 'qux' }
	 */
	query: URLSearchParams,
	/**
	 * Requested resource with the type prefix removed
	 * @example /api/foo/bar -> foo/bar
	 * @example /assets/foo/bar -> foo/bar
	 */
	route: string,
	/**
	 * Requested resource type prefix
	 * @example /api/foo/bar -> api
	 * @example /assets/foo/bar -> assets
	 */
	type: string,
	/**
	 * Full URL
	 * @example /api/foo/bar?baz=qux
	 */
	toString(): string,
}
