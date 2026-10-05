import { describe, expect, test } from 'bun:test'
import * as oauth from './index'

describe('basis/oauth public surface', () => {
  test('exposes only the Identity capability', () => {
    expect(Object.keys(oauth).sort()).toEqual(['Identity'])
  })

  test('models exactly two browser scopes on Identity', () => {
    expect(Object.keys(oauth.Identity.Scope).sort()).toEqual(['Domain', 'Subdomain'])
  })
})
