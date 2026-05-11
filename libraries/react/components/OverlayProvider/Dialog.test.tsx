import { beforeEach, describe, expect, test } from 'bun:test'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Button } from '../Button/Button'
import { Editor } from '../Editor/Editor'
import { Dialog } from './Dialog'
import { OverlayProvider } from './OverlayProvider'

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

/** Mount and unmount an empty OverlayProvider so `window.overlayProvider` is cleared between tests. */
async function resetOverlayProvider() {
  const rendered = await render(<OverlayProvider />)
  rendered.unmount()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
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
      labelConfirm: 'Save',
      props: { label: 'Thing editor' },
      title: 'Edit',
    })

    const bump = await waitFor(() => node.querySelector<HTMLButtonElement>('[data-testid="bump"]'))
    bump.click()

    expect(bump.dataset.label).toBe('Thing editor')

    const save = await findButton(node, 'Save')
    save.click()

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
      labelCancel: 'Close',
      props: { label: 'Thing editor' },
      title: 'Edit',
    })

    const close = await findButton(node, 'Close')
    close.click()

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.editor passes props through to the editor', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const changes: TestValue[] = []
    const result: Promise<TestValue | false> = Dialog.editor(TestEditor, { id: 99 }, {
      labelConfirm: 'OK',
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
