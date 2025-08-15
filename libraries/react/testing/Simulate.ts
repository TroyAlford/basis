import type { Mock } from 'bun:test'
import type { Keyboard } from '../types/Keyboard'

/**
 * Simulates user interactions with React elements in a way that works with React 19's async rendering.
 */
export const Simulate = {
  /**
   * Simulates a change event on an input or textarea element by setting its value and dispatching an appropriate event.
   * Uses native value setter and dispatches input/change events, compatible with Happy DOM and React.
   * @param element The element to simulate the change on
   * @param value The new value to set
   * @param handler Optional handler to expect to be called as a result of the change event
   * @param timeout The timeout in milliseconds to wait for the event to be processed (default 100)
   * @returns Promise that resolves when the handler has been called or rejects on timeout
   */
  async change<T extends HTMLInputElement | HTMLTextAreaElement>(
    element: T,
    value: string,
    handler?: Mock<(...args: unknown[]) => void>,
    timeout = 100,
  ): Promise<void> {
    const prototype = Object.getPrototypeOf(element)
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!nativeSetter) throw new Error('Could not get native value setter')
    nativeSetter.call(element, value)

    // Workaround for Happy DOM: ensure composedPath exists
    if (!('composedPath' in Event.prototype)) {
      Object.defineProperty(Event.prototype, 'composedPath', {
        value() {
          return [this.target]
        },
      })
    }

    const tag = element.tagName.toLowerCase()
    const type = (element as HTMLInputElement).type
    const shouldUseInputEvent =
      tag === 'textarea' || (tag === 'input' && type === 'text')

    const eventType = shouldUseInputEvent ? 'input' : 'change'
    const event = shouldUseInputEvent
      ? new InputEvent('input', { bubbles: true, cancelable: true })
      : new Event('change', { bubbles: true, cancelable: true })

    element.dispatchEvent(event)

    await Promise.resolve()

    // If no handler provided, just return after dispatching the event
    if (!handler) {
      return Promise.resolve()
    }

    return Simulate.event(element, handler, { timeout, type: eventType })
  },

  /**
   * Simulates an event and waits for the specified handler to be called.
   * @param element The element to dispatch the event on
   * @param handler The handler to expect
   * @param config Configuration for the simulation and expected callback
   * @param config.type The type of event to simulate
   * @param config.key The key to press
   * @param config.timeout The timeout in milliseconds to wait for the event to be processed
   */
  async event<T extends HTMLElement>(
    element: T,
    handler: Mock<(...args: unknown[]) => void>,
    config: {
      key?: string,
      timeout?: number,
      type: string,
    },
  ): Promise<void> {
    const { key, timeout = 100, type } = config
    let called = false

    const isMock = 'mock' in handler
    if (isMock) {
      const original = handler
      const proxy = (...args: unknown[]) => {
        called = true
        return original(...args)
      }
      handler.mockImplementationOnce(proxy)
    }

    let event: Event
    if (type === 'keydown') {
      event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
    } else {
      event = new Event(type, { bubbles: true, cancelable: true })
    }
    element.dispatchEvent(event)

    const start = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        if (called || (handler.mock && handler.mock.calls.length > 0)) return resolve()
        if (Date.now() - start > timeout) {
          return reject(new Error(`Expected handler to be called on ${type} within ${timeout}ms`))
        }
        setTimeout(check, 5)
        return void 0
      }
      return check()
    })
  },

  /**
   * Shorthand for expectEvent with type 'keydown'.
   * @param element The element to simulate the key press on
   * @param key The key to press
   * @param handler The handler to expect
   * @param timeout The timeout in milliseconds to wait for the event to be processed
   * @returns Promise that resolves after the event is processed
   */
  async keyDown<T extends HTMLElement>(
    element: T,
    key: Keyboard,
    handler: Mock<(...args: unknown[]) => void>,
    timeout?: number,
  ): Promise<void> {
    return Simulate.event(element, handler, { key, timeout, type: 'keydown' })
  },
}
