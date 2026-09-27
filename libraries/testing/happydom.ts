import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { beforeEach } from 'bun:test'

GlobalRegistrator.register()

beforeEach(() => {
  // reset NODE_ENV
  Bun.env.NODE_ENV = 'test'

  // reset global window
  global.window = new Window() as Window & typeof globalThis
  global.document = global.window.document
  global.fetch = global.window.fetch

  // Create a mutable location object for testing
  let currentLocation = new URL('https://example.com/')
  Object.defineProperty(global.window, 'location', {
    configurable: true,
    get: () => currentLocation,
    set: (newLocation: URL) => { currentLocation = newLocation },
  })

  // Make pathname and search writable for tests
  Object.defineProperty(currentLocation, 'pathname', {
    configurable: true,
    value: '/',
    writable: true,
  })

  Object.defineProperty(currentLocation, 'search', {
    configurable: true,
    value: '',
    writable: true,
  })

  // Mock history API to avoid security restrictions in tests
  const mockPushState = (_, __, url?: string) => {
    if (url) {
      const newURL = new URL(url, 'https://example.com')
      currentLocation = newURL
    }
  }

  const mockReplaceState = (_, __, url?: string) => {
    if (url) {
      const newURL = new URL(url, 'https://example.com')
      currentLocation = newURL
    }
  }

  Object.defineProperty(global.window.history, 'pushState', {
    configurable: true,
    value: mockPushState,
    writable: true,
  })

  Object.defineProperty(global.window.history, 'replaceState', {
    configurable: true,
    value: mockReplaceState,
    writable: true,
  })
})
