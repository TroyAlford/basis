import { describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Dialog } from './Dialog'
import { OverlayProvider } from './OverlayProvider'
import { Toast } from './Toast'

describe('OverlayProvider', () => {
  describe('Dialog', () => {
    test('Dialog.open throws clearly when no OverlayProvider is mounted', () => {
      expect(() => Dialog.open({
        buttons: [{ label: 'Ok', value: 'ok' }],
        cancelValue: 'cancel',
      })).toThrow('OverlayProvider is not mounted')
    })

    test('Dialog.open renders a native dialog with title and content', async () => {
      const { node, unmount } = await render(<OverlayProvider />)

      Dialog.open({
        buttons: [{ label: 'Ok', value: 'ok' }],
        cancelValue: 'cancel',
        content: <p>Dialog content</p>,
        title: 'Dialog title',
      })

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog.dialog-view.component'))
      expect(dialog).toBeInstanceOf(HTMLDialogElement)
      expect(dialog.textContent).toContain('Dialog title')
      expect(dialog.textContent).toContain('Dialog content')

      unmount()
    })

    test('clicking a button resolves with that button value', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.open({
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Save', value: 'save' },
        ],
        cancelValue: 'escape',
      })

      const save = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Save') as HTMLButtonElement | undefined)
      save.click()

      expect(await result).toBe('save')
      await waitFor(() => !node.querySelector('dialog'))

      unmount()
    })

    test('native cancel resolves with cancelValue', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.open({
        buttons: [{ label: 'Ok', value: 'ok' }],
        cancelValue: 'escape',
      })

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))

      expect(await result).toBe('escape')
      await waitFor(() => !node.querySelector('dialog'))

      unmount()
    })

    test('Dialog.confirm resolves true for confirm', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.confirm({ confirmLabel: 'Delete' })

      const confirm = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Delete') as HTMLButtonElement | undefined)
      confirm.click()

      expect(await result).toBe(true)

      unmount()
    })

    test('Dialog.confirm resolves false for cancel', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.confirm({ cancelLabel: 'No' })

      const cancel = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'No') as HTMLButtonElement | undefined)
      cancel.click()

      expect(await result).toBe(false)

      unmount()
    })
  })

  describe('Toast', () => {
    test('Toast.create throws clearly when no OverlayProvider is mounted', () => {
      expect(() => Toast.create({ title: 'Missing provider' })).toThrow('OverlayProvider is not mounted')
    })

    test('Toast.create renders a toast in the toast region and returns a handle', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const toast = Toast.create({
        content: 'Saved',
        status: Toast.Status.Success,
        title: 'Done',
      })

      expect(toast.id).toStartWith('toast-')
      expect(toast.update).toBeFunction()
      expect(toast.dismiss).toBeFunction()

      const region = await waitFor(() => node.querySelector('.overlay-toast-region.component'))
      const aside = await waitFor(() => region.querySelector<HTMLElement>('aside.toast-view.component'))
      expect(aside.dataset.status).toBe('success')
      expect(aside.textContent).toContain('Done')
      expect(aside.textContent).toContain('Saved')

      unmount()
    })

    test('handle.update updates the same toast', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const toast = Toast.create({ content: 'Starting', status: Toast.Status.Loading })

      const aside = await waitFor(() => node.querySelector<HTMLElement>('aside.toast-view.component'))
      toast.update({ content: 'Finished', status: Toast.Status.Success })

      await waitFor(() => aside.textContent?.includes('Finished'))
      expect(node.querySelectorAll('aside.toast-view.component')).toHaveLength(1)
      expect(aside.dataset.status).toBe('success')

      unmount()
    })

    test('handle.dismiss removes the toast', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const toast = Toast.create({ content: 'Dismiss me' })

      await waitFor(() => node.querySelector('aside.toast-view.component'))
      toast.dismiss()

      await waitFor(() => !node.querySelector('aside.toast-view.component'))

      unmount()
    })

    test('numeric timeout dismisses the toast', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Toast.create({ content: 'Temporary', timeout: 100 })

      await waitFor(() => node.querySelector('aside.toast-view.component'))
      await waitFor(() => !node.querySelector('aside.toast-view.component'), { timeout: 1_000 })

      unmount()
    })

    test('timeout null does not auto-dismiss', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Toast.create({ content: 'Persistent', timeout: null })

      await waitFor(() => node.querySelector('aside.toast-view.component'))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(node.querySelector('aside.toast-view.component')).toBeTruthy()

      unmount()
    })
  })
})
