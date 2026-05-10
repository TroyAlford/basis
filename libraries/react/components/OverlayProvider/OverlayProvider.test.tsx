import { describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Dialog } from './Dialog'
import { Notification } from './Notification'
import { OverlayProvider } from './OverlayProvider'

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

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog.dialog.component'))
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
      const result = Dialog.confirm({ labelConfirm: 'Delete' })

      const confirm = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Delete') as HTMLButtonElement | undefined)
      confirm.click()

      expect(await result).toBe(true)

      unmount()
    })

    test('Dialog.confirm with Intent.Danger uses danger dialog intent on header', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Dialog.confirm({ intent: Dialog.Intent.Danger, title: 'Remove?' })

      const header = await waitFor(() => node.querySelector<HTMLElement>('dialog header'))
      expect(header?.dataset.intent).toBe('danger')
      expect(header?.querySelector('svg.icon')).toBeTruthy()

      unmount()
    })

    test('Dialog.open with success intent shows SquareCheck in header', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.open({
        buttons: [{ label: 'Done', value: true }],
        cancelValue: false,
        content: 'Saved.',
        intent: Dialog.Intent.Success,
        title: 'Saved',
      })

      const header = await waitFor(() => node.querySelector<HTMLElement>('dialog header'))
      expect(header?.dataset.intent).toBe('success')
      expect(header?.querySelector('svg.icon')).toBeTruthy()

      const done = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Done') as HTMLButtonElement | undefined)
      done.click()

      expect(await result).toBe(true)

      unmount()
    })

    test('Dialog.confirm resolves false for cancel', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const result = Dialog.confirm({ labelCancel: 'No' })

      const cancel = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'No') as HTMLButtonElement | undefined)
      cancel.click()

      expect(await result).toBe(false)

      unmount()
    })
  })

  describe('Notification', () => {
    test('Notification.create throws clearly when no OverlayProvider is mounted', () => {
      expect(() => Notification.create({ title: 'Missing provider' })).toThrow('OverlayProvider is not mounted')
    })

    test('Notification.create renders in the notifications region and returns a handle', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const note = Notification.create({
        content: 'Saved',
        intent: Notification.Intent.Primary,
        title: 'Done',
      })

      expect(note.id).toStartWith('notification-')
      expect(note.update).toBeFunction()
      expect(note.dismiss).toBeFunction()

      const region = await waitFor(() => node.querySelector('.notifications.component'))
      const aside = await waitFor(() => region.querySelector<HTMLElement>('aside.notification.component'))
      expect(aside.dataset.intent).toBe('primary')
      expect(aside.textContent).toContain('Done')
      expect(aside.textContent).toContain('Saved')

      unmount()
    })

    test('Notification.create with success intent renders SquareCheck in header', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Notification.create({
        content: 'OK',
        intent: Notification.Intent.Success,
        title: 'Done',
      })

      const aside = await waitFor(() => node.querySelector<HTMLElement>('aside.notification.component'))
      expect(aside.dataset.intent).toBe('success')
      expect(aside.querySelector('header svg.icon')).toBeTruthy()

      unmount()
    })

    test('handle.update updates the same notification', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const note = Notification.create({ content: 'Starting', intent: Notification.Intent.Default })

      const aside = await waitFor(() => node.querySelector<HTMLElement>('aside.notification.component'))
      note.update({ content: 'Finished', intent: Notification.Intent.Primary })

      await waitFor(() => aside.textContent?.includes('Finished'))
      expect(node.querySelectorAll('aside.notification.component')).toHaveLength(1)
      expect(aside.dataset.intent).toBe('primary')

      unmount()
    })

    test('handle.dismiss removes the notification', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      const note = Notification.create({ content: 'Dismiss me' })

      await waitFor(() => node.querySelector('aside.notification.component'))
      note.dismiss()

      await waitFor(() => !node.querySelector('aside.notification.component'))

      unmount()
    })

    test('numeric timeout dismisses the notification', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Notification.create({ content: 'Temporary', timeout: 100 })

      await waitFor(() => node.querySelector('aside.notification.component'))
      await waitFor(() => !node.querySelector('aside.notification.component'), { timeout: 1_000 })

      unmount()
    })

    test('timeout null does not auto-dismiss', async () => {
      const { node, unmount } = await render(<OverlayProvider />)
      Notification.create({ content: 'Persistent', timeout: null })

      await waitFor(() => node.querySelector('aside.notification.component'))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(node.querySelector('aside.notification.component')).toBeTruthy()

      unmount()
    })
  })
})
