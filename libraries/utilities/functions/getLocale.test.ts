import { expect, test } from 'bun:test'
import { getLocale } from './getLocale'

test('getLocale', () => {
  // Mock navigator for testing
  const originalNavigator = global.navigator

  Object.defineProperty(global, 'navigator', {
    value: originalNavigator,
    writable: true,
  })

  try {
    // Test with navigator.languages
    global.navigator = {
      language: 'en-US',
      languages: ['fr-FR', 'en-US'],
    } as unknown as Navigator
    expect(getLocale()).toBe('fr-FR')

    // Test with navigator.language
    global.navigator = {
      language: 'de-DE',
      languages: [],
    } as unknown as Navigator
    expect(getLocale()).toBe('de-DE')

    // Test fallback
    global.navigator = {} as Navigator
    expect(getLocale()).toBe('en-US')

    // Test undefined navigator (server-side)
    global.navigator = undefined
    expect(getLocale()).toBe('en-US')
  } finally {
    global.navigator = originalNavigator
  }
})
