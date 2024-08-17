import { describe, expect, test } from 'bun:test'
import { matchTemplateURI } from './matchTemplateURI'

describe('matchTemplateURI', () => {
  test('should return the first matching URI', () => {
    expect(matchTemplateURI('/user/123', ['/user/:id', '/:type/:id'])).toEqual('/user/:id')
    expect(matchTemplateURI('/type/123', ['/user/:id?', '/:type/:id'])).toEqual('/:type/:id')
  })

  test('should return null if no URI matches', () => {
    expect(matchTemplateURI('/user/123', ['/foo/:id', '/bar/:id'])).toBeUndefined()
  })
})
