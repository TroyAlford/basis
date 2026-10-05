import { describe, expect, test } from 'bun:test'
import * as auth from './index'

describe('basis/auth public surface', () => {
  test('exposes only the supported primitives', () => {
    expect(Object.keys(auth).sort()).toEqual([
      'clearIdentityCookie',
      'encryptIdentity',
      'readIdentity',
      'registrableDomain',
      'setIdentityCookie',
    ])
  })
})
