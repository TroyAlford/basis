import { describe, expect, test } from 'bun:test'
import { matchURI } from './matchURI'

describe('matchURI', () => {
	test('should return the first matching URI', () => {
		expect(matchURI('/user/123', ['/user/:id', '/:type/:id'])).toEqual('/user/:id')
		expect(matchURI('/type/123', ['/user/:id?', '/:type/:id'])).toEqual('/:type/:id')
	})

	test('should return null if no URI matches', () => {
		expect(matchURI('/user/123', ['/foo/:id', '/bar/:id'])).toBeUndefined()
	})
})