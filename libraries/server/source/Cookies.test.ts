import { describe, expect, test } from 'bun:test'
import { Cookies, serializeCookie } from './Cookies'

const roundTrip = (value: string): string | undefined => {
  const header = serializeCookie({ name: 'pref', value }).split(';')[0] ?? ''
  return new Cookies<{ pref: string }>(header).get('pref')
}

describe('Cookies', () => {
  test('round-trips spaces, percent signs, Unicode, and reserved characters', () => {
    for (const value of ['hello world', '100%', 'café 🚀', 'a;b,c=d?e/f']) {
      expect(roundTrip(value)).toBe(value)
    }
  })

  test('preserves malformed percent-encoded request values', () => {
    expect(new Cookies('bad=%E0%A4%A').get('bad')).toBe('%E0%A4%A')
  })

  test('exposes decoded values', () => {
    expect(new Cookies('first=hello%20world; second=100%25').values()).toEqual({
      first: 'hello world',
      second: '100%',
    })
  })
})
