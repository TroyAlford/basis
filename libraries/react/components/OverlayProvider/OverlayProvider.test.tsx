import { beforeEach, describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Button } from '../Button/Button'
import { Dialog } from './Dialog'
import { Notification } from './Notification'
import { OverlayProvider } from './OverlayProvider'

/**
 * Clears the process-local overlay provider singleton between tests.
 */
async function resetOverlayProvider() {
  const rendered = await render(<OverlayProvider />)
  rendered.unmount()
  await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Renders a provider for a single test.
 * @returns The rendered provider helper.
 */
async function renderOverlayProvider() {
  return await render(<OverlayProvider />)
}

describe('OverlayProvider', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  describe('Dialog', () => {
    test('Dialog.open throws clearly when no OverlayProvider is mounted', () => {
      expect(() => Dialog.open({
        buttons: [{ label: 'Ok', value: 'ok' }],
      })).toThrow('OverlayProvider is not mounted')
    })

    test('Dialog.open renders default buttons', async () => {
      const { node, unmount } = await renderOverlayProvider()

      Dialog.open()

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog.dialog.component'))
      expect(dialog.textContent).toContain('Cancel')
      expect(dialog.textContent).toContain('OK')

      unmount()
    })

    test('Dialog.open default OK resolves confirm', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open()

      const ok = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'OK') as HTMLButtonElement | undefined)
      ok.click()

      expect(await result).toBe('confirm')

      unmount()
    })

    test('Dialog.open default Cancel resolves cancel', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open()

      const cancel = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Cancel') as HTMLButtonElement | undefined)
      cancel.click()

      expect(await result).toBe(false)

      unmount()
    })

    test('Dialog.open default native cancel resolves cancel', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open()

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))

      expect(await result).toBe(false)

      unmount()
    })

    test('Dialog.open renders a native dialog with title and content', async () => {
      const { node, unmount } = await renderOverlayProvider()

      const result = Dialog.open({
        content: <p>Dialog content</p>,
        title: 'Dialog title',
      })

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog.dialog.component'))
      expect(dialog).toBeInstanceOf(HTMLDialogElement)
      expect(dialog.textContent).toContain('Dialog title')
      expect(dialog.textContent).toContain('Dialog content')

      const ok = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'OK') as HTMLButtonElement | undefined)
      ok.click()

      expect(await result).toBe('confirm')

      unmount()
    })

    test('custom button values resolve their selected value', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open<'read' | 'write' | 'cancel'>({
        buttons: [
          { label: 'Read', value: 'read' },
          { label: 'Write', value: 'write' },
          { label: 'Cancel', value: 'cancel' },
        ],
      })

      const write = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Write') as HTMLButtonElement | undefined)
      write.click()

      expect(await result).toBe('write')
      await waitFor(() => !node.querySelector('dialog'))

      unmount()
    })

    test('dialog button intent is present in the DOM', async () => {
      const { node, unmount } = await renderOverlayProvider()

      Dialog.open({
        buttons: [
          { intent: Dialog.Intent.Danger, label: 'Delete', value: 'delete' },
          { label: 'Cancel', value: 'cancel' },
        ],
      })

      const button = await waitFor(() => node.querySelector<HTMLButtonElement>('button[data-intent="danger"]'))
      expect(button.textContent).toBe('Delete')

      unmount()
    })

    test('provider unmount resolves the active dialog with false', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open<'save' | 'close'>({
        buttons: [
          { label: 'Save', value: 'save' },
          { label: 'Close', value: 'close' },
        ],
      })

      await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
      unmount()

      expect(await result).toBe(false)
    })

    test('provider unmount resolves queued dialogs with false', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const first = Dialog.open<'first' | 'first-cancel'>({
        buttons: [
          { label: 'First', value: 'first' },
          { label: 'Cancel', value: 'first-cancel' },
        ],
      })
      const second = Dialog.open<'second' | 'second-cancel'>({
        buttons: [
          { label: 'Second', value: 'second' },
          { label: 'Cancel', value: 'second-cancel' },
        ],
      })

      await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
      unmount()

      expect(await first).toBe(false)
      expect(await second).toBe(false)
    })

    test('native cancel resolves false', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open<'ok' | 'cancel'>({
        buttons: [
          { label: 'Ok', value: 'ok' },
          { label: 'Cancel', value: 'cancel' },
        ],
      })

      const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))

      expect(await result).toBe(false)
      await waitFor(() => !node.querySelector('dialog'))

      unmount()
    })

    test('Dialog.confirm resolves true for confirm', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.confirm({ labelConfirm: 'Delete' })

      const confirm = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Delete') as HTMLButtonElement | undefined)
      confirm.click()

      expect(await result).toBe(true)

      unmount()
    })

    test('Dialog.confirm with Intent.Danger uses danger dialog intent on header', async () => {
      const { node, unmount } = await renderOverlayProvider()
      Dialog.confirm({ intent: Dialog.Intent.Danger, title: 'Remove?' })

      const dialog = await waitFor(() => node.querySelector<HTMLElement>('dialog.dialog.component'))
      expect(dialog?.dataset.intent).toBe('danger')
      expect(dialog?.querySelector('header svg.icon')).toBeTruthy()

      unmount()
    })

    test('Dialog.open with success intent shows SquareCheck in header', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open({
        buttons: [{ label: 'Done', value: true }],
        content: 'Saved.',
        intent: Dialog.Intent.Success,
        title: 'Saved',
      })

      const dialog = await waitFor(() => node.querySelector<HTMLElement>('dialog.dialog.component'))
      expect(dialog?.dataset.intent).toBe('success')
      expect(dialog?.querySelector('header svg.icon')).toBeTruthy()

      const done = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Done') as HTMLButtonElement | undefined)
      done.click()

      expect(await result).toBe(true)

      unmount()
    })

    test('JSX buttons resolve from data-value', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open<'ok' | 'custom' | 'cancel'>({
        buttons: [
          <Button data-value="ok">OK</Button>,
          <Button data-value="custom">Custom</Button>,
          <Button data-value="cancel">Cancel</Button>,
        ],
      })

      const custom = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'Custom') as HTMLButtonElement | undefined)
      custom.click()

      expect(await result).toBe('custom')

      unmount()
    })

    test('object and JSX buttons can be mixed', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const result = Dialog.open<'object' | 'jsx' | 'cancel'>({
        buttons: [
          { label: 'Object', value: 'object' },
          <Button data-value="jsx">JSX</Button>,
          <Button data-value="cancel">Cancel</Button>,
        ],
      })

      const jsx = await waitFor(() => Array.from(node.querySelectorAll('button'))
        .find(button => button.textContent === 'JSX') as HTMLButtonElement | undefined)
      jsx.click()

      expect(await result).toBe('jsx')

      unmount()
    })

    test('Dialog.confirm resolves false for cancel', async () => {
      const { node, unmount } = await renderOverlayProvider()
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
      const { node, unmount } = await renderOverlayProvider()
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
      const { node, unmount } = await renderOverlayProvider()
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
      const { node, unmount } = await renderOverlayProvider()
      const note = Notification.create({ content: 'Starting', intent: Notification.Intent.Default })

      const aside = await waitFor(() => node.querySelector<HTMLElement>('aside.notification.component'))
      note.update({ content: 'Finished', intent: Notification.Intent.Primary })

      await waitFor(() => aside.textContent?.includes('Finished'))
      expect(node.querySelectorAll('aside.notification.component')).toHaveLength(1)
      expect(aside.dataset.intent).toBe('primary')

      unmount()
    })

    test('handle.dismiss removes the notification', async () => {
      const { node, unmount } = await renderOverlayProvider()
      const note = Notification.create({ content: 'Dismiss me' })

      await waitFor(() => node.querySelector('aside.notification.component'))
      note.dismiss()

      await waitFor(() => !node.querySelector('aside.notification.component'))

      unmount()
    })

    test('numeric timeout dismisses the notification', async () => {
      const { node, unmount } = await renderOverlayProvider()
      Notification.create({ content: 'Temporary', timeout: 100 })

      await waitFor(() => node.querySelector('aside.notification.component'))
      await waitFor(() => !node.querySelector('aside.notification.component'), { timeout: 1_000 })

      unmount()
    })

    test('timeout null does not auto-dismiss', async () => {
      const { node, unmount } = await renderOverlayProvider()
      Notification.create({ content: 'Persistent', timeout: null })

      await waitFor(() => node.querySelector('aside.notification.component'))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(node.querySelector('aside.notification.component')).toBeTruthy()

      unmount()
    })

    test('dismiss control has an accessible label', async () => {
      const { node, unmount } = await renderOverlayProvider()
      Notification.create({ content: 'Dismiss me' })

      const dismiss = await waitFor(() => (
        node.querySelector('[role="button"][aria-label="Dismiss"]')
      ))

      expect(dismiss).toBeTruthy()

      unmount()
    })
  })
})
