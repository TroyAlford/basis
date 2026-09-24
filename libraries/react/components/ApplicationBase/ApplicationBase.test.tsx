import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import type { ServerEvent } from '../../runtime'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Dialog } from '../OverlayProvider/Dialog'
import { ApplicationBase } from './ApplicationBase'

/** Minimal `EventSource` stand-in so subscription lifecycle can be asserted. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  closed = false
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void { this.closed = true }
  emit(data: string): void { this.onmessage?.({ data }) }
}

/** An application that observes one server endpoint. */
class EventsApplication extends ApplicationBase {
  received: ServerEvent[] = []
  protected get subscriptions() {
    return [{ url: '/events' }]
  }
  protected onServerEvent(event: ServerEvent): void {
    this.received.push(event)
  }
}

export class TestApplication extends ApplicationBase {
  get defaultContext() {
    return {
      ...super.defaultContext,
      foo: 'bar',
    }
  }
}

class LayoutApplication extends ApplicationBase {
  protected layout(content: ReactNode): ReactNode {
    return (
      <main className="layout-content">
        {content}
      </main>
    )
  }
}

describe('Application', () => {
  describe('Context', () => {
    test('default context', async () => {
      const { instance, unmount } = await render<TestApplication>(<TestApplication />)
      expect(instance.state.context).toEqual(instance.defaultContext)
      unmount()
    })

    test('setContext', async () => {
      const { instance, unmount } = await render<TestApplication>(<TestApplication />)

      await instance.setContext({ foo: 'baz' })
      expect(instance.state.context).toEqual({ foo: 'baz' })

      await instance.setContext({ foo: { bar: 'baz' } })
      expect(instance.state.context).toEqual({ foo: { bar: 'baz' } })

      unmount()
    })
  })

  describe('window', () => {
    test('window.application & window.ApplicationContext', async () => {
      const { instance, unmount } = await render<TestApplication>(<TestApplication />)

      // @ts-expect-error - window is not defined in the global scope
      expect(window.ApplicationBase).toBe(instance)
      // @ts-expect-error - window is not defined in the global scope
      expect(window.ApplicationContext).toBe(instance.Context)

      unmount()
    })
  })

  describe('OverlayProvider', () => {
    test('renders an OverlayProvider after layout content', async () => {
      const { node, unmount } = await render<LayoutApplication>(<LayoutApplication />)

      const layout = node.querySelector('.layout-content')
      const overlay = node.querySelector('.overlay-provider.component')

      expect(overlay).toBeTruthy()
      expect(layout?.nextElementSibling).toBe(overlay)

      unmount()
    })

    test('opens dialogs through the built-in OverlayProvider', async () => {
      const { node, unmount } = await render<TestApplication>(<TestApplication />)

      Dialog.open({
        buttons: [
          { label: 'Ok', value: 'ok' },
          { label: 'Cancel', value: 'cancel' },
        ],
        content: 'Built-in provider content',
        title: 'Built-in provider',
      })

      const dialog = await waitFor(() => node.querySelector('dialog.dialog.component'))
      expect(dialog.textContent).toContain('Built-in provider')
      expect(dialog.textContent).toContain('Built-in provider content')

      unmount()
    })
  })

  describe('Runtime', () => {
    test('reads the platform facts the server embedded in the SPA shell', async () => {
      const script = document.createElement('script')
      script.id = 'basis-runtime'
      script.type = 'application/json'
      script.textContent = JSON.stringify({ gitSha: 'abc123', serviceName: 'command-center', version: '1.0.0' })
      document.body.appendChild(script)

      try {
        const { instance, unmount } = await render<TestApplication>(<TestApplication />)

        expect(instance.state.runtime.runtime).toEqual({
          gitSha: 'abc123',
          serviceName: 'command-center',
          version: '1.0.0',
        })
        // Startup facts stay out of the application's domain context.
        expect(instance.state.context).toEqual(instance.defaultContext)

        unmount()
      } finally {
        script.remove()
      }
    })

    test('connects declared subscriptions after mount and closes them on unmount', async () => {
      const globals = globalThis as unknown as Record<string, unknown>
      const original = globals.EventSource
      globals.EventSource = FakeEventSource
      FakeEventSource.instances = []

      try {
        const { instance, unmount } = await render<EventsApplication>(<EventsApplication />)

        expect(FakeEventSource.instances).toHaveLength(1)
        expect(FakeEventSource.instances[0].url).toBe('/events')

        FakeEventSource.instances[0].emit('{"event":"snapshot","data":{"n":1}}')
        expect(instance.received).toEqual([{ data: { n: 1 }, event: 'snapshot' }])

        unmount()
        await Bun.sleep(1)
        expect(FakeEventSource.instances[0].closed).toBe(true)
      } finally {
        globals.EventSource = original
      }
    })
  })
})
