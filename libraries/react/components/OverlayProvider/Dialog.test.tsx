import { beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { Button } from '../Button/Button'
import { Editor } from '../Editor/Editor'
import { Dialog } from './Dialog'
import { OverlayProvider } from './OverlayProvider'

interface Thing {
  id: number,
}

/** Editor used to assert {@link Dialog.editor} typing and resolution. */
class TestEditor extends Editor<Thing, HTMLDivElement> {
  static displayName = 'TestEditor'

  content(): React.ReactNode {
    return (
      <button
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

    const y = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'Y') as HTMLButtonElement | undefined)
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

    const snap = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'Snap') as HTMLButtonElement | undefined)
    snap.click()

    expect(await result).toBe(1)
    unmount()
  })

  test('Dialog.editor resolves with TestEditor.current on confirm', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    // @ts-expect-error TS2589 — Editor defaultProps depth when inferring Dialog.editor return; runtime is correct.
    const result = Dialog.editor(TestEditor, {
      labelConfirm: 'Save',
      props: { initialValue: { id: 1 } },
      title: 'Edit',
    })

    const bump = await waitFor(() => node.querySelector<HTMLButtonElement>('[data-testid="bump"]'))
    bump.click()

    const save = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'Save') as HTMLButtonElement | undefined)
    save.click()

    expect(await result).toEqual({ id: 2 })
    unmount()
  })

  test('Dialog.editor resolves false when cancelled', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(TestEditor, {
      labelCancel: 'Close',
      props: { initialValue: { id: 0 } },
      title: 'Edit',
    })

    const close = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'Close') as HTMLButtonElement | undefined)
    close.click()

    expect(await result).toBe(false)
    unmount()
  })

  test('Dialog.editor passes props through to the editor', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.editor(TestEditor, {
      labelConfirm: 'OK',
      props: { initialValue: { id: 99 } },
      title: 'Props',
    })

    const ok = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'OK') as HTMLButtonElement | undefined)
    ok.click()

    expect(await result).toEqual({ id: 99 })
    unmount()
  })

  test('Dialog.confirm still resolves booleans', async () => {
    const { node, unmount } = await render(<OverlayProvider />)
    const result = Dialog.confirm({ title: 'Sure?' })

    const ok = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'OK') as HTMLButtonElement | undefined)
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

    const go = await waitFor(() => Array.from(node.querySelectorAll('button'))
      .find(button => button.textContent === 'Go') as HTMLButtonElement | undefined)
    go.click()

    expect(await result).toBe('go')
    unmount()
  })
})
