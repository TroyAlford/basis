import { describe, expect, test } from 'bun:test'
import { parseURI } from './parseURI'

describe('parseURI', () => {
	test('parses a URL into its components', () => {
		const uri = parseURI('http://example.com/foo/bar?baz=qux')
		expect(uri).toMatchObject({
			path: '/foo/bar',
			query: new URLSearchParams('baz=qux'),
			route: 'bar',
			type: 'foo',
		})
		expect(uri.toString()).toBe('/foo/bar?baz=qux')
	})

	test('handles URLs without a query string', () => {
		const uri = parseURI('http://example.com/foo/bar')
		expect(uri).toMatchObject({
			path: '/foo/bar',
			query: new URLSearchParams(),
			route: 'bar',
			type: 'foo',
		})
		expect(uri.toString()).toBe('/foo/bar')
	})
})
