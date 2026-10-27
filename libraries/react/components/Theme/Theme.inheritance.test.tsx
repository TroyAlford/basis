import { beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { DropdownMenu } from '../DropdownMenu/DropdownMenu'
import { Dialog } from '../OverlayProvider/Dialog'
import { OverlayProvider } from '../OverlayProvider/OverlayProvider'
import { resetOverlayProvider } from '../OverlayProvider/OverlayProvider.testUtil.tsx'
import { DARK_THEME, Theme } from './Theme'

describe('themed overlays', () => {
  beforeEach(async () => {
    await resetOverlayProvider()
  })

  test('a dialog mounts inside the dark application root and uses the same theme', async () => {
    const rendered = await render(
      <div data-theme="dark">
        <Theme name="dark" {...DARK_THEME} />
        <OverlayProvider />
      </div>,
    )

    Dialog.open({ title: 'Dark dialog' })
    const dialog = await waitFor(() => rendered.node.querySelector<HTMLDialogElement>('dialog.dialog.component'))

    expect(dialog.closest('[data-theme="dark"]')).not.toBeNull()
    expect(rendered.node.contains(dialog)).toBe(true)

    rendered.unmount()
  })

  test('a popup menu mounts inside the dark application root and uses the same theme', async () => {
    const rendered = await render(
      <div data-theme="dark">
        <Theme name="dark" {...DARK_THEME} />
        <DropdownMenu trigger="Open menu">
          <DropdownMenu.Item>Item</DropdownMenu.Item>
        </DropdownMenu>
      </div>,
    )

    rendered.node.querySelector<HTMLButtonElement>('.trigger')?.click()
    await rendered.update()
    const menu = await waitFor(() => rendered.node.querySelector<HTMLElement>('.popup-menu.component'))

    expect(menu.closest('[data-theme="dark"]')).not.toBeNull()
    expect(rendered.node.contains(menu)).toBe(true)

    rendered.unmount()
  })
})
