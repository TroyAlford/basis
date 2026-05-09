import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Dialog } from '../OverlayProvider/Dialog'
import { ApplicationBase } from './ApplicationBase'

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
        buttons: [{ label: 'Ok', value: 'ok' }],
        cancelValue: 'cancel',
        content: 'Built-in provider content',
        title: 'Built-in provider',
      })

      const dialog = await waitFor(() => node.querySelector('dialog.dialog-view.component'))
      expect(dialog.textContent).toContain('Built-in provider')
      expect(dialog.textContent).toContain('Built-in provider content')

      unmount()
    })
  })
})
