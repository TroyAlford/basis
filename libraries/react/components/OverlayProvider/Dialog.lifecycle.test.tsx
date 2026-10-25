import { beforeEach, describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
import { Keyboard } from '../../types/Keyboard'
import { Editor } from '../Editor/Editor'
import { TextEditor } from '../TextEditor/TextEditor'
import { Dialog } from './Dialog'
import { OverlayProvider } from './OverlayProvider'
import { resetOverlayProvider } from './OverlayProvider.testUtil.tsx'

interface Draft {
  id: number,
  name: string,
}

class DraftEditor extends Editor<Draft, HTMLDivElement, { label: string }> {
  static displayName = 'DraftEditor'

  get tag(): 'div' {
    return 'div'
  }

  content() {
    return (
      <TextEditor
        field="name"
        value={this.current.name}
        onChange={this.handleField}
      />
    )
  }
}

/**
 * Find a rendered button by its visible label.
 * @param node - Root node to search.
 * @param label - Button text to match.
 * @returns Matching button once rendered.
 */
async function findButton(node: ParentNode, label: string): Promise<HTMLButtonElement> {
  return waitFor(() => Array.from(node.querySelectorAll('button'))
    .find(button => button.textContent === label) as HTMLButtonElement | undefined)
}

/**
 * Find the rendered editor input.
 * @param node - Root node to search.
 * @returns Matching input once rendered.
 */
async function findInput(node: ParentNode): Promise<HTMLInputElement> {
  return waitFor(() => (
    node.querySelector<HTMLInputElement>('[data-field="name"] input.value, [data-field="name"] .value') ?? undefined
  ))
}

describe('managed dialog handles', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('Dialog.open returns an awaitable handle with a stable id and methods', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.open({ content: 'Handle', title: 'Handle' })

    expect(dialog.id).toMatch(/^[0-9A-Za-z-]{12}$/)
    expect(typeof dialog.then).toBe('function')
    expect(typeof dialog.update).toBe('function')
    expect(typeof dialog.dismiss).toBe('function')
    expect(typeof dialog.resolve).toBe('function')

    const rendered = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    dialog.update({ title: 'Updated' })
    await waitFor(() => rendered.textContent?.includes('Updated'))

    expect(node.querySelector('dialog')).toBe(rendered)
    expect(dialog.id).toMatch(/^[0-9A-Za-z-]{12}$/)

    await dialog.resolve(true)
    expect(await dialog).toBe(true)
    unmount()
  })

  test('JSX content shorthand has no implicit footer and resolves through its handle', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.open<string>(<span>Loading</span>)

    const rendered = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    expect(rendered.querySelectorAll('footer button')).toHaveLength(0)
    expect(rendered.textContent).toContain('Loading')

    dialog.update({ content: <span>Loaded!</span> })
    await waitFor(() => rendered.textContent?.includes('Loaded!'))
    await dialog.resolve('ready')

    expect(await dialog).toBe('ready')
    unmount()
  })

  test('update patches only supplied fields and post-settlement updates are no-ops', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.open({
      buttons: [{ label: 'Finish', value: 'finished' }],
      content: 'Original content',
      intent: Dialog.Intent.Success,
      title: 'Original title',
    })

    const rendered = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    dialog.update({ title: 'Changed title' })

    await waitFor(() => rendered.textContent?.includes('Changed title'))
    expect(rendered.textContent).toContain('Original content')
    expect(rendered.dataset.intent).toBe('success')

    await dialog.resolve('finished')
    expect(await dialog).toBe('finished')

    dialog.update({ content: 'Too late', title: 'No longer mounted' })
    await waitFor(() => !node.querySelector('dialog'))
    expect(node.querySelector('dialog')).toBeNull()
    unmount()
  })
})

describe('dialog lifecycle callbacks', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('resolution and dismissal run the matching argument-free callback family once', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    const dialog = Dialog.open<'saved'>({
      buttons: [
        { label: 'Save', value: 'saved' },
        { label: 'Cancel', value: false },
      ],
      onDismissed: () => { events.push('dismissed') },
      onDismissing: () => { events.push('dismissing') },
      onResolved: value => { events.push(`resolved:${value}`) },
      onResolving: value => { events.push(`resolving:${value}`) },
    })

    const save = await findButton(node, 'Save')
    save.click()

    expect(await dialog).toBe('saved')
    expect(events).toEqual(['resolving:saved', 'resolved:saved'])
    unmount()
  })

  test('static value false is a dismissal, while an explicit resolve(false) is a resolution', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    const dismissed = Dialog.open<boolean>({
      buttons: [{ label: 'Cancel', value: false }],
      onDismissed: () => events.push('cancel:dismissed'),
      onResolved: () => events.push('cancel:resolved'),
    })

    const cancel = await findButton(node, 'Cancel')
    cancel.click()
    expect(await dismissed).toBe(false)
    expect(events).toEqual(['cancel:dismissed'])

    events.length = 0
    const resolved = Dialog.open<boolean>({
      buttons: [{ label: 'No', resolve: () => false }],
      onDismissed: () => events.push('no:dismissed'),
      onResolved: value => events.push(`no:resolved:${value}`),
    })

    const no = await findButton(node, 'No')
    no.click()
    expect(await resolved).toBe(false)
    expect(events).toEqual(['no:resolved:false'])
    unmount()
  })

  test('sync and async vetoes keep the dialog open without settling', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let allow = false

    const dialog = Dialog.open<'ok'>({
      buttons: [{ label: 'Go', value: 'ok' }],
      onResolving: async () => allow,
    })

    const go = await findButton(node, 'Go')
    go.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(node.querySelector('dialog')).not.toBeNull()

    allow = true
    go.click()
    expect(await dialog).toBe('ok')
    unmount()
  })

  test('a thrown guard reports the error and keeps the dialog active', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const errors: unknown[] = []
    const error = new Error('Nope')

    const dialog = Dialog.open<'ok'>({
      buttons: [{ label: 'Go', value: 'ok' }],
      onError: reported => errors.push(reported),
      onResolving: () => { throw error },
    })

    const go = await findButton(node, 'Go')
    go.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(errors).toEqual([error])
    expect(node.querySelector('dialog')).not.toBeNull()

    await expect(dialog.resolve('ok')).rejects.toBe(error)
    expect(node.querySelector('dialog')).not.toBeNull()
    unmount()
  })

  test('concurrent resolve and dismiss do not start a second transition or rerun a guard', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })

    const dialog = Dialog.open<'ok'>({
      buttons: [{ label: 'Go', value: 'ok' }],
      onResolving: async () => {
        calls += 1
        await gate
        return true
      },
    })

    const first = dialog.resolve('ok')
    const repeated = dialog.resolve('ok')
    const dismissed = dialog.dismiss()

    expect(await dismissed).toBe(false)
    release()

    expect(await first).toBe(true)
    expect(await repeated).toBe(true)
    expect(await dialog).toBe('ok')
    expect(calls).toBe(1)
    expect(node.querySelector('dialog')).toBeNull()
    unmount()
  })

  test('provider unmount forces dismissal without running onDismissing', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    const dialog = Dialog.open<boolean>({
      content: 'Teardown',
      onDismissed: () => { events.push('dismissed') },
      onDismissing: () => {
        events.push('dismissing')
        return false
      },
    })

    await waitFor(() => node.querySelector('dialog'))
    unmount()

    expect(await dialog).toBe(false)
    expect(events).toEqual(['dismissed'])
  })
})

describe('Dialog.choice and string confirm', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('Dialog.choice renders ordered resolving choices and returns the selected literal', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const choice = Dialog.choice('Would you like some marmalade?', [
      ['yes', 'Yes, Please'],
      ['no', 'No, Thank You'],
    ] as const)

    const buttons = await waitFor(() => {
      const rendered = Array.from(node.querySelectorAll<HTMLButtonElement>('footer button'))
      return rendered.length === 2 ? rendered : undefined
    })
    expect(buttons.map(button => button.textContent)).toEqual(['Yes, Please', 'No, Thank You'])

    const no = await findButton(node, 'No, Thank You')
    no.click()

    expect(await choice).toBe('no')
    unmount()
  })

  test('Dialog.choice with an offered false value resolves false rather than abandoning', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []
    const choice = Dialog.open<boolean>({
      buttons: [
        { label: 'No', resolve: () => false },
        { label: 'Yes', value: true },
      ],
      onDismissed: () => { events.push('dismissed') },
      onResolved: value => { events.push(`resolved:${value}`) },
    })

    const no = await findButton(node, 'No')
    no.click()

    expect(await choice).toBe(false)
    expect(events).toEqual(['resolved:false'])
    unmount()
  })

  test('string Dialog.confirm uses Yes / No and resolves false for No', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm('Are you sure?')

    expect(await findButton(node, 'Yes')).toBeDefined()
    const no = await findButton(node, 'No')
    no.click()

    expect(await result).toBe(false)
    unmount()
  })

  test('object Dialog.confirm preserves its labels and handle', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({
      labelCancel: 'Keep',
      labelConfirm: 'Remove',
      title: 'Remove it?',
    })

    expect(typeof result.update).toBe('function')
    const remove = await findButton(node, 'Remove')
    remove.click()

    expect(await result).toBe(true)
    unmount()
  })
})

describe('persistent dialog actions', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('an action keeps the dialog open and never resolves it', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []
    let calls = 0

    const dialog = Dialog.open({
      buttons: [
        { action: () => { calls += 1 }, label: 'Save' },
        { label: 'Close', value: false },
      ],
      onResolved: () => { events.push('resolved') },
      onResolving: () => { events.push('resolving') },
    })

    const save = await findButton(node, 'Save')
    save.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    save.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(calls).toBe(2)
    expect(events).toEqual([])
    expect(node.querySelector('dialog')).not.toBeNull()

    const close = await findButton(node, 'Close')
    close.click()
    expect(await dialog).toBe(false)
    unmount()
  })

  test('an in-flight action blocks dismissal, duplicate activation, and Enter', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let calls = 0
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })

    const dialog = Dialog.open({
      buttons: [
        { action: async () => { calls += 1; await pending }, label: 'Save' },
        { label: 'Cancel', value: false },
      ],
    })

    const save = await findButton(node, 'Save')
    save.click()
    await waitFor(() => save.disabled)

    const cancel = await findButton(node, 'Cancel')
    cancel.click()
    await Simulate.pressKey(node.querySelector('dialog') as HTMLDialogElement, Keyboard.Enter)

    expect(calls).toBe(1)
    expect(await dialog.dismiss()).toBe(false)
    expect(node.querySelector('dialog')).not.toBeNull()

    release()
    await waitFor(() => !save.disabled)
    save.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(2)

    cancel.click()
    expect(await dialog).toBe(false)
    unmount()
  })

  test('a failed action reports its error, stays open, and remains retryable', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const error = new Error('Save failed')
    const errors: unknown[] = []
    let attempts = 0

    const dialog = Dialog.open({
      buttons: [
        {
          action: () => {
            attempts += 1
            if (attempts === 1) throw error
          },
          label: 'Save',
        },
        { label: 'Close', value: false },
      ],
      onError: reported => errors.push(reported),
    })

    const save = await findButton(node, 'Save')
    save.click()

    await waitFor(() => errors.length === 1)
    expect(errors).toEqual([error])
    expect(node.querySelector('dialog')).not.toBeNull()

    await waitFor(() => !save.disabled)
    save.click()
    await waitFor(() => attempts === 2)

    const close = await findButton(node, 'Close')
    close.click()
    expect(await dialog).toBe(false)
    unmount()
  })

  test('an action is never an implicit Enter target', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let calls = 0

    const dialog = Dialog.open({
      buttons: [{ action: () => { calls += 1 }, label: 'Save' }],
      content: 'Persistent',
    })

    const rendered = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    await Simulate.pressKey(rendered, Keyboard.Enter)

    expect(calls).toBe(0)
    expect(node.querySelector('dialog')).not.toBeNull()

    await dialog.dismiss()
    unmount()
  })
})

describe('modal stacking', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('a dismissal guard can open and settle a nested confirmation without deadlock', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    const parent = Dialog.open({
      buttons: [{ label: 'Close', value: false }],
      content: 'Parent content',
      onDismissing: async () => {
        events.push('guard')
        const discard = await Dialog.confirm({
          labelCancel: 'Keep editing',
          labelConfirm: 'Discard',
          title: 'Discard changes?',
        })
        events.push(discard ? 'discard' : 'keep')
        return discard
      },
    })

    const close = await findButton(node, 'Close')
    close.click()

    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const dialogs = Array.from(node.querySelectorAll<HTMLDialogElement>('dialog'))
    expect(dialogs[0].textContent).toContain('Parent content')
    expect(dialogs[1].textContent).toContain('Discard changes?')
    expect(dialogs[0].open).toBe(true)
    expect(dialogs[1].open).toBe(true)

    const discard = await findButton(node, 'Discard')
    discard.click()

    expect(await parent).toBe(false)
    expect(events).toEqual(['guard', 'discard'])
    await waitFor(() => node.querySelectorAll('dialog').length === 0)
    unmount()
  })

  test('only the top dialog responds to Escape and non-top programmatic requests return false', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const parent = Dialog.open({ content: 'Parent', title: 'Parent' })
    const parentDialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))

    const child = Dialog.open({ content: 'Child', title: 'Child' })
    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const childDialog = Array.from(node.querySelectorAll<HTMLDialogElement>('dialog'))[1]

    await Simulate.pressKey(parentDialog, Keyboard.Escape)
    expect(node.querySelectorAll('dialog')).toHaveLength(2)
    expect(await parent.dismiss()).toBe(false)

    await Simulate.pressKey(childDialog, Keyboard.Escape)
    expect(await child).toBe(false)
    await waitFor(() => node.querySelectorAll('dialog').length === 1)

    expect(await parent.resolve(true)).toBe(true)
    expect(await parent).toBe(true)
    unmount()
  })

  test('provider unmount settles every stacked dialog as dismissal', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const first = Dialog.open({ content: 'First' })
    const second = Dialog.open({ content: 'Second' })

    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    unmount()

    expect(await first).toBe(false)
    expect(await second).toBe(false)
  })

  test('closing the root dialog restores the original trigger focus', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const { node, unmount } = await render(<OverlayProvider />, target)
    const trigger = document.createElement('button')
    trigger.textContent = 'Trigger'
    document.body.append(trigger)
    trigger.focus()

    const dialog = Dialog.open({ content: 'Focus' })
    await waitFor(() => node.querySelector('dialog'))
    expect(document.activeElement).not.toBe(trigger)

    await dialog.resolve(true)
    await waitFor(() => document.activeElement === trigger)

    trigger.remove()
    unmount()
    target.remove()
  })

  test('closing a child restores focus inside the mounted parent, and background updates do not steal it', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const { node, unmount } = await render(<OverlayProvider />, target)
    const parent = Dialog.open({
      content: <button data-testid="inner" type="button">Inner</button>,
      title: 'Parent',
    })

    const parentDialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const inner = parentDialog.querySelector<HTMLButtonElement>('[data-testid="inner"]') as HTMLButtonElement
    inner.focus()

    const child = Dialog.open({ content: 'Child', title: 'Child' })
    await waitFor(() => node.querySelectorAll('dialog').length === 2)

    const childDialog = Array.from(node.querySelectorAll<HTMLDialogElement>('dialog'))[1]
    childDialog.focus()

    parent.update({ title: 'Parent updated' })
    await waitFor(() => parentDialog.textContent?.includes('Parent updated'))
    expect(document.activeElement).toBe(childDialog)

    await child.resolve(true)
    await waitFor(() => document.activeElement === inner)

    await parent.resolve(true)
    unmount()
    target.remove()
  })
})

describe('dialog editor lifecycle', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('a clean editor dismisses immediately', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const cancel = await findButton(node, 'Cancel')
    cancel.click()

    expect(await result).toBe(false)
    await waitFor(() => node.querySelectorAll('dialog').length === 0)
    unmount()
  })

  test('a dirty editor asks before discarding and keeps its draft on veto', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Unsaved draft')

    const cancel = await findButton(node, 'Cancel')
    cancel.click()

    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const keep = await findButton(node, 'Keep editing')
    keep.click()

    await waitFor(() => node.querySelectorAll('dialog').length === 1)
    expect(node.querySelector<HTMLInputElement>('[data-field="name"] input.value, [data-field="name"] .value')?.value)
      .toBe('Unsaved draft')

    const dialog = node.querySelector<HTMLDialogElement>('dialog') as HTMLDialogElement
    await Simulate.pressKey(dialog, Keyboard.Escape)
    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const discard = await findButton(node, 'Discard')
    discard.click()

    expect(await result).toBe(false)
    await waitFor(() => node.querySelectorAll('dialog').length === 0)
    unmount()
  })

  test('reverting to the baseline counts as clean', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Changed')
    await Simulate.change(input, '')

    const cancel = await findButton(node, 'Cancel')
    cancel.click()

    expect(await result).toBe(false)
    await waitFor(() => node.querySelectorAll('dialog').length === 0)
    unmount()
  })

  test('chrome updates retain the mounted editor and its draft', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Keep me')

    dialog.update({ title: 'Workspace draft' })
    await waitFor(() => node.textContent?.includes('Workspace draft'))

    const retained = node.querySelector('[data-field="name"] input.value, [data-field="name"] .value')
    expect(retained).toBe<Element | null>(input)
    expect(input.value).toBe('Keep me')

    const cancel = await findButton(node, 'Cancel')
    cancel.click()
    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const discard = await findButton(node, 'Discard')
    discard.click()
    expect(await dialog).toBe(false)
    unmount()
  })

  test('a deliberate value update changes the working value and resolve result without remounting', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const dialog = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Local draft')

    dialog.update({ props: { value: { id: 2, name: 'External' } } })
    await waitFor(() => input.value === 'External')

    const retained = node.querySelector('[data-field="name"] input.value, [data-field="name"] .value')
    expect(retained).toBe<Element | null>(input)

    const ok = await findButton(node, 'OK')
    ok.click()
    expect(await dialog).toEqual({ id: 2, name: 'External' })
    unmount()
  })

  test('onResolving receives the latest value, can veto, and bypasses the abandonment guard', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const seen: Draft[] = []
    let veto = true

    const dialog = Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      onResolving: value => {
        seen.push(value)
        return !veto
      },
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Latest')

    const ok = await findButton(node, 'OK')
    ok.click()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(seen).toEqual([{ id: 1, name: 'Latest' }])
    expect(node.querySelector('dialog')).not.toBeNull()
    expect(input.value).toBe('Latest')

    veto = false
    ok.click()
    expect(await dialog).toEqual({ id: 1, name: 'Latest' })
    unmount()
  })

  test('the consumer dismissal guard runs only after the built-in discard decision', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const events: string[] = []

    Dialog.editor(DraftEditor, { id: 1, name: '' }, {
      onDismissing: () => {
        events.push('consumer')
        return false
      },
      props: { label: 'Draft' },
      title: 'Edit',
    })

    const input = await findInput(node)
    await Simulate.change(input, 'Dirty')

    const cancel = await findButton(node, 'Cancel')
    cancel.click()
    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    expect(events).toEqual([])

    const discard = await findButton(node, 'Discard')
    discard.click()
    await waitFor(() => events.length === 1)

    expect(events).toEqual(['consumer'])
    expect(node.querySelectorAll('dialog')).toHaveLength(1)

    const cancelAgain = await findButton(node, 'Cancel')
    cancelAgain.click()
    await waitFor(() => node.querySelectorAll('dialog').length === 2)
    const keep = await findButton(node, 'Keep editing')
    keep.click()

    await waitFor(() => node.querySelectorAll('dialog').length === 1)
    expect(node.querySelectorAll('dialog')).toHaveLength(1)
    unmount()
  })
})
