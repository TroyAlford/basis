import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { NavigateEvent } from '../../events/NavigateEvent'
import { navigate } from './navigate'
import { registerNavigationGuard } from './navigationGuards'

describe('navigate', () => {
  let dispatchEvent: Mock<Window['dispatchEvent']>

  beforeEach(() => {
    dispatchEvent = spyOn(window, 'dispatchEvent')
  })

  afterEach(() => {
    dispatchEvent.mockRestore()
  })

  test('updates history and dispatches NavigateEvent', async () => {
    await navigate('/test/path')

    expect(window.location.pathname).toBe('/test/path')
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(NavigateEvent))
    const event = dispatchEvent.mock.calls[0][0] as NavigateEvent
    expect(event.detail.url).toBe('/test/path')
  })

  test('does not update history when a navigation guard blocks navigation', async () => {
    const unregister = registerNavigationGuard(() => false)

    try {
      const navigated = await navigate('/blocked/path')

      expect(navigated).toBe(false)
      expect(window.location.pathname).not.toBe('/blocked/path')
      expect(dispatchEvent).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })
})
