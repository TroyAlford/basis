import { describe, expect, test } from 'bun:test'
import { parseTemplateURI } from './parseTemplateURI'

describe('parseTemplateURI', () => {
  test('should parse a URI', () => {
    expect(parseTemplateURI('/user/123', '/:type/:id'))
      .toEqual({ id: '123', type: 'user' })
    expect(parseTemplateURI('/user/123', '/:type/:id?'))
      .toEqual({ id: '123', type: 'user' })
  })

  describe('query parameters', () => {
    test('should automatically add query parameters', () => {
      expect(parseTemplateURI('/some/path?foo=1&bar=2', '/some/path'))
        .toEqual({ bar: '2', foo: '1' })
    })

    test('requires template-specified query parameters', () => {
      expect(parseTemplateURI('/some/path?foo=1', '/some/path?foo=1')).toEqual({ foo: '1' })
      expect(parseTemplateURI('/some/path?bar=2', '/some/path?foo=1')).toBeNull()
    })

    test('allows wildcards in query parameters', () => {
      expect(parseTemplateURI('/some/path?foo=1', '/some/path?foo=*')).toEqual({ foo: '1' })
      expect(parseTemplateURI('/some/path?bar=2', '/some/path?foo=*')).toBeNull()
    })
  })

  describe('precedence', () => {
    test('path values supersede query values', () => {
      expect(parseTemplateURI('/person/123?id=wrong&type=fake', '/:type/:id'))
        .toEqual({ id: '123', type: 'person' })
    })
  })
})
