import { beforeEach, describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
import { Keyboard } from '../../types/Keyboard'
import { Button } from '../Button/Button'
import { Editor } from '../Editor/Editor'
import { TextEditor } from '../TextEditor/TextEditor'
import { Dialog } from './Dialog'
import { NameSlugEditor } from './NameSlugEditor.testEditor.tsx'
import { OverlayProvider } from './OverlayProvider'
import { resetOverlayProvider } from './OverlayProvider.testUtil.tsx'

interface TestValue {
  id: number,
}

/** Editor used to assert {@link Dialog.editor} typing and resolution. */
class TestEditor extends Editor<TestValue, HTMLDivElement, { label: string }> {
  static displayName = 'TestEditor'

  content() {
    return (
      <button
        data-label={this.props.label}
        data-testid="bump"
        type="button"
        onClick={() => void this.handleChange({ id: this.current.id + 1 })}
      >
        bump
      </button>
    )
  }

  get tag(): 'div' {
    return 'div'
  }
}

/**
 * Find a dialog button by its visible label.
 * @param node - Root node to search.
 * @param label - Button text to match.
 * @returns Matching button once rendered.
 */
async function findButton(node: ParentNode, label: string) {
  return waitFor(() => Array.from(node.querySelectorAll('button'))
    .find(button => button.textContent === label) as HTMLButtonElement | undefined)
}

describe('Dialog.open with resolve and Dialog.editor', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('Dialog.open with static object button values still resolves the chosen value', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.open<'x' | 'y'>({
      buttons: [
        { label: 'X', value: 'x' },
        { label: 'Y', value: 'y' },
      ],
      title: 'Pick',
    })

    const y = await findButton(node, 'Y')
    y.click()

    expect(await result).toBe('y')
    unmount()
  })

  test('Dialog.open with a resolve button reads the value at activation time', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    let counter = 0
    const result = Dialog.open<number>({
      buttons: [{ label: 'Snap', resolve: () => ++counter }],
      title: 'Resolve',
    })

    const snap = await findButton(node, 'Snap')
    snap.click()

    expect(await result).toBe(1)
    unmount()
  })

  test('Dialog.editor resolves with TestEditor.current on confirm', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(TestEditor, { id: 1 }, {
      props: { label: 'Thing editor' },
      title: 'Edit',
    })

    const bump = await waitFor(() => node.querySelector<HTMLButtonElement>('[data-testid="bump"]'))
    bump.click()

    expect(bump.dataset.label).toBe('Thing editor')

    const ok = await findButton(node, 'OK')
    ok.click()

    const resolved = await result
    expect(resolved).toEqual({ id: 2 })
    if (resolved !== false) {
      expect(resolved.id).toBe(2)
    }
    unmount()
  })

  test('Dialog.editor resolves false when cancelled', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(TestEditor, { id: 0 }, {
      props: { label: 'Thing editor' },
      title: 'Edit',
    })

    const cancel = await findButton(node, 'Cancel')
    cancel.click()

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.editor passes props through to the editor', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const changes: TestValue[] = []
    const result: Promise<TestValue | false> = Dialog.editor(TestEditor, { id: 99 }, {
      props: {
        label: 'Tracked',
        onChange: value => changes.push(value),
      },
      title: 'Props',
    })

    const bump = await waitFor(() => node.querySelector<HTMLButtonElement>('[data-testid="bump"]'))
    bump.click()

    const ok = await findButton(node, 'OK')
    ok.click()

    expect(changes).toEqual([{ id: 100 }])
    expect(await result).toEqual({ id: 100 })
    unmount()
  })

  test('Dialog.editor rejects non-editor components', async () => {
    const { unmount } = await render(<OverlayProvider />)

    class NotAnEditor {
      current = { id: 0 }
    }

    expect(() => Dialog.editor(
      NotAnEditor,
      { id: 0 },
      { props: { label: 'Invalid' } },
    )).toThrow('Dialog.editor: expected an Editor subclass constructor')

    unmount()
  })

  test('Dialog.confirm still resolves booleans', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({ title: 'Sure?' })

    const ok = await findButton(node, 'OK')
    ok.click()

    expect(await result).toBe(true)
    unmount()
  })

  test('Dialog.open with JSX Button data-value still works', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.open<'go' | 'stop'>({
      buttons: [
        <Button key="g" data-value="go">Go</Button>,
        { label: 'Stop', value: 'stop' },
      ],
      title: 'JSX',
    })

    const go = await findButton(node, 'Go')
    go.click()

    expect(await result).toBe('go')
    unmount()
  })
})

describe('Dialog keyboard', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('Dialog.editor confirms on Enter when a single-line TextEditor is focused', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(NameSlugEditor, { name: '', slug: '' }, { title: 'New' })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const nameInput = await waitFor(
      () => dialog.querySelector<HTMLInputElement>('[data-field="name"] input.value, [data-field="name"] .value'),
    )

    await Simulate.change(nameInput, 'My Article')
    await Simulate.pressKey(nameInput, Keyboard.Enter)

    expect(await result).toEqual({ name: 'My Article', slug: '' })
    unmount()
  })

  test('Dialog.editor cancels on native cancel event', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(NameSlugEditor, { name: '', slug: '' }, { title: 'New' })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.confirm cancels on Escape key', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({ title: 'Sure?' })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    await Simulate.pressKey(dialog, Keyboard.Escape)

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.editor cancels on Escape when focus is in a TextEditor field', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(NameSlugEditor, { name: '', slug: '' }, { title: 'New' })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const nameInput = await waitFor(
      () => dialog.querySelector<HTMLInputElement>('[data-field="name"] input.value, [data-field="name"] .value'),
    )

    await Simulate.pressKey(nameInput, Keyboard.Escape)

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.confirm cancels on Escape when focus is on the confirm button', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({
      labelConfirm: 'Discard changes',
      title: 'Discard unsaved changes?',
    })

    const discard = await findButton(node, 'Discard changes')
    discard.focus()
    await Simulate.pressKey(discard, Keyboard.Escape)

    expect(await result).toBe(false)
    unmount()
  })

  test('Enter in a multiline TextEditor does not confirm Dialog.editor', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(NameSlugEditor, { name: '', slug: '' }, { title: 'New' })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const slugInput = await waitFor(
      () => dialog.querySelector<HTMLTextAreaElement>('[data-field="slug"] textarea.value, [data-field="slug"] .value'),
    )

    let settled = false
    void result.then(() => { settled = true })

    await Simulate.pressKey(slugInput, Keyboard.Enter)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(settled).toBe(false)
    expect(dialog.open).toBe(true)
    unmount()
  })

  test('Enter does not confirm when multiple non-cancel actions are ambiguous', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.open<'x' | 'y'>({
      buttons: [
        { label: 'X', value: 'x' },
        { label: 'Y', value: 'y' },
      ],
      content: <TextEditor initialValue="draft" />,
      title: 'Pick',
    })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const input = await waitFor(() => dialog.querySelector<HTMLInputElement>('.text-editor .value'))

    let settled = false
    void result.then(() => { settled = true })

    await Simulate.pressKey(input, Keyboard.Enter)
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(settled).toBe(false)
    expect(dialog.open).toBe(true)
    unmount()
  })

  test('Dialog.confirm confirms on Enter when focus is in content TextEditor', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({
      content: <TextEditor initialValue="typed" />,
      title: 'Sure?',
    })

    const dialog = await waitFor(() => node.querySelector<HTMLDialogElement>('dialog'))
    const input = await waitFor(() => dialog.querySelector<HTMLInputElement>('.text-editor .value'))

    await Simulate.pressKey(input, Keyboard.Enter)

    expect(await result).toBe(true)
    unmount()
  })
})
