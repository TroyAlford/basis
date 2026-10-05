import { describe, expect, test } from 'bun:test'
import { registrableDomain } from './domain'

describe('registrableDomain', () => {
  test('returns an empty string for a missing or blank host', () => {
    expect(registrableDomain(null)).toBe('')
    expect(registrableDomain('')).toBe('')
    expect(registrableDomain('   ')).toBe('')
  })

  test('lowercases the host and strips the port', () => {
    expect(registrableDomain('CC.TroyAlford.COM:8443')).toBe('troyalford.com')
  })

  test('keeps the last two labels of a longer name', () => {
    expect(registrableDomain('cc.troyalford.com')).toBe('troyalford.com')
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com')
  })

  test('returns a two-label name unchanged', () => {
    expect(registrableDomain('troyalford.com')).toBe('troyalford.com')
  })

  describe('parseHost cases', () => {
    test('handles localhost with and without a subdomain', () => {
      expect(registrableDomain('localhost')).toBe('localhost')
      expect(registrableDomain('foo.localhost:3000')).toBe('localhost')
    })

    test('handles an apex domain', () => {
      expect(registrableDomain('nerdrage.wiki')).toBe('nerdrage.wiki')
    })

    test('handles a subdomain', () => {
      expect(registrableDomain('admin.nerdrage.wiki')).toBe('nerdrage.wiki')
    })

    test('handles an ipv4 host with a port', () => {
      expect(registrableDomain('127.0.0.1:8080')).toBe('127.0.0.1')
    })
  })

  test('documents the last-two-label limitation for public suffixes', () => {
    expect(registrableDomain('example.co.uk')).toBe('co.uk')
  })
})
