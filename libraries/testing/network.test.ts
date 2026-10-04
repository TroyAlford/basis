import { describe, expect, test } from 'bun:test'
import { DEFAULT_ALLOWED_HOSTS, isRequestAllowed } from './network'

describe('network policy', () => {
  test('allows loopback by default', () => {
    expect(isRequestAllowed('http://localhost:3000/app')).toBe(true)
    expect(isRequestAllowed('http://127.0.0.1:3000/app')).toBe(true)
  })

  test('allows Google Fonts by default so text renders the real web type', () => {
    expect(DEFAULT_ALLOWED_HOSTS).toContain('fonts.googleapis.com')
    expect(DEFAULT_ALLOWED_HOSTS).toContain('fonts.gstatic.com')
    expect(isRequestAllowed('https://fonts.googleapis.com/css2?family=Ubuntu')).toBe(true)
    expect(isRequestAllowed('https://fonts.gstatic.com/s/ubuntu/v20/abc.woff2')).toBe(true)
  })

  test('blocks other CDNs by default', () => {
    expect(isRequestAllowed('https://esm.sh/shiki@3.0.0')).toBe(false)
    expect(isRequestAllowed('https://cdn.example.com/thing.js')).toBe(false)
  })

  test('allows extra hosts the caller opts into', () => {
    expect(isRequestAllowed('https://esm.sh/shiki@3.0.0', { allow: ['esm.sh'] })).toBe(true)
  })

  test('blocks a malformed URL', () => {
    expect(isRequestAllowed('not a url')).toBe(false)
  })
})
