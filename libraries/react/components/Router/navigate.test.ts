import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { NavigateEvent } from '../../events/NavigateEvent'
import { navigate } from './navigate'

describe('navigate', () => {
  let dispatchEvent: Mock<Window['dispatchEvent']>

  beforeEach(() => {
    dispatchEvent = spyOn(window, 'dispatchEvent')
  })

  afterEach(() => {
    dispatchEvent.mockRestore()
  })

  test('updates history and dispatches NavigateEvent', () => {
    navigate('/test/path')

    expect(window.location.pathname).toBe('/test/path')
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(NavigateEvent))
    const event = dispatchEvent.mock.calls[0][0] as NavigateEvent
    expect(event.detail.url).toBe('/test/path')
  })
})
