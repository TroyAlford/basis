import { beforeEach, describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Dialog } from './Dialog'
import { Notification } from './Notification'
import { OverlayProvider } from './OverlayProvider'
import { resetOverlayProvider } from './OverlayProvider.testUtil.tsx'

/**
 * Wait for the single notification row.
 * @param node - Root node to search.
 * @returns The rendered notification element.
 */
async function findNotification(node: ParentNode): Promise<HTMLElement> {
  return waitFor(() => node.querySelector<HTMLElement>('aside.notification.component') ?? undefined)
}

describe('notification lifecycle', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('dismiss runs the shared argument-free callbacks once', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    const note = Notification.create({
      content: 'Dismiss me',
      onDismissed: () => { events.push('dismissed') },
      onDismissing: () => { events.push('dismissing') },
    })

    await findNotification(node)
    expect(await note.dismiss()).toBe(true)

    expect(events).toEqual(['dismissing', 'dismissed'])
    await waitFor(() => !node.querySelector('aside.notification.component'))
    unmount()
  })

  test('onDismissed observes the notification row already removed', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let observed: boolean | undefined

    const note = Notification.create({
      content: 'Hook order',
      onDismissed: () => {
        observed = !!node.querySelector('aside.notification.component')
      },
    })

    await findNotification(node)
    expect(await note.dismiss()).toBe(true)
    await waitFor(() => observed !== undefined)

    expect(observed).toBe(false)
    unmount()
  })

  test('a vetoed dismissal keeps the notification and returns false', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let allow = false

    const note = Notification.create({
      content: 'Vetoed',
      onDismissing: async () => allow,
    })

    await findNotification(node)
    expect(await note.dismiss()).toBe(false)
    expect(node.querySelector('aside.notification.component')).not.toBeNull()

    allow = true
    expect(await note.dismiss()).toBe(true)
    await waitFor(() => !node.querySelector('aside.notification.component'))
    unmount()
  })

  test('a thrown guard reports through onError and leaves the notification visible', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const error = new Error('Blocked')
    const errors: unknown[] = []

    const note = Notification.create({
      content: 'Blocked',
      onDismissing: () => { throw error },
      onError: reported => errors.push(reported),
    })

    await findNotification(node)
    await expect(note.dismiss()).rejects.toBe(error)

    expect(errors).toEqual([error])
    expect(node.querySelector('aside.notification.component')).not.toBeNull()
    unmount()
  })

  test('a vetoed timer is consumed once and does not retry until a new timeout is supplied', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let allow = false

    const note = Notification.create({
      content: 'Timeout',
      onDismissing: () => allow,
      timeout: 30,
    })

    await findNotification(node)
    await new Promise<void>(resolve => setTimeout(resolve, 80))

    expect(node.querySelector('aside.notification.component')).not.toBeNull()

    await new Promise<void>(resolve => setTimeout(resolve, 80))
    expect(node.querySelector('aside.notification.component')).not.toBeNull()

    allow = true
    note.update({ timeout: 30 })
    await waitFor(() => !node.querySelector('aside.notification.component'), { timeout: 1_000 })
    unmount()
  })

  test('content and intent updates do not reset the timer', async () => {
    const { node, unmount } = await render(<OverlayProvider />)

    const note = Notification.create({
      content: 'Starting',
      timeout: 200,
    })

    await findNotification(node)
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    note.update({ content: 'Updated', intent: Notification.Intent.Primary })

    await waitFor(() => !node.querySelector('aside.notification.component'), { timeout: 1_000 })
    unmount()
  })

  test('an explicit timeout update arms the timer and null disables it', async () => {
    const { node, unmount } = await render(<OverlayProvider />)

    const armed = Notification.create({ content: 'Armed', timeout: null })
    await findNotification(node)
    armed.update({ timeout: 30 })
    await waitFor(() => !node.querySelector('aside.notification.component'), { timeout: 1_000 })

    const disarmed = Notification.create({ content: 'Disarmed', timeout: 30 })
    await findNotification(node)
    disarmed.update({ timeout: null })
    await new Promise<void>(resolve => setTimeout(resolve, 100))

    expect(node.querySelector('aside.notification.component')).not.toBeNull()
    await disarmed.dismiss()
    unmount()
  })

  test('multiple notifications keep their creation order', async () => {
    const { node, unmount } = await render(<OverlayProvider />)

    Notification.create({ content: 'First' })
    Notification.create({ content: 'Second' })
    Notification.create({ content: 'Third' })

    const rows = await waitFor(() => {
      const rendered = Array.from(node.querySelectorAll<HTMLElement>('aside.notification.component'))
      return rendered.length === 3 ? rendered : undefined
    })

    expect(rows.map(row => row.querySelector('section')?.textContent)).toEqual(['First', 'Second', 'Third'])
    unmount()
  })

  test('notifications coexist with a modal dialog without displacing it', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.open({ content: 'Modal', title: 'Modal' })

    const rendered = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const note = Notification.create({ content: 'Background note' })

    await findNotification(node)
    expect(rendered.open).toBe(true)
    expect(node.querySelectorAll('dialog')).toHaveLength(1)

    await note.dismiss()
    expect(await dialog.dismiss()).toBe(true)
    expect(await dialog).toBe(false)
    unmount()
  })

  test('provider unmount clears timers and runs onDismissed once per row', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    Notification.create({
      content: 'Teardown',
      onDismissed: () => { events.push('dismissed') },
      onDismissing: () => {
        events.push('dismissing')
        return false
      },
      timeout: 60_000,
    })

    await findNotification(node)
    unmount()

    await waitFor(() => events.length === 1)
    expect(events).toEqual(['dismissed'])
  })
})
