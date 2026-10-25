import { beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { waitFor } from '../../testing/waitFor'
import { styles } from '../../utilities/style'
import { DropdownMenu } from '../DropdownMenu/DropdownMenu'
import { Dialog } from '../OverlayProvider/Dialog'
import { OverlayProvider } from '../OverlayProvider/OverlayProvider'
import { resetOverlayProvider } from '../OverlayProvider/OverlayProvider.testUtil.tsx'
import { DARK_THEME, Theme } from './Theme'

import '../Button/Button.styles.ts'
import '../Documentation/Documentation.styles.ts'
import '../Menu/Menu.styles.ts'
import '../NumberEditor/NumberEditor.styles.ts'
import '../OverlayProvider/Dialog.styles.ts'
import '../OverlayProvider/Notification.styles.ts'
import '../PopupMenu/PopupMenu.styles.ts'
import '../Table/Cell.styles.ts'
import '../Table/HeaderCell.styles.ts'
import '../Table/Table.styles.ts'
import '../TextEditor/TextEditor.styles.ts'
import '../ToggleEditor/ToggleEditor.styles.ts'
import '../Tooltip/Tooltip.styles.ts'
import '../../mixins/PrefixSuffix.styles.ts'

/**
 * Extract one balanced selector block from the registered styles.
 * @param selector - The selector that starts the block.
 * @returns The block, including its opening and closing braces.
 */
function block(selector: string): string {
  const css = styles()
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, index + 1)
    }
  }

  return ''
}

describe('themed control inheritance', () => {
  test('Button resolves default, hover, selected, focus, and disabled colours from its theme', () => {
    const css = block('.button.component')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-button-/)
    expect(css).toMatch(/background-color:\s*var\(--basis-button-background,\s*var\(--basis-color-surface\)\)/)
    expect(css).toMatch(/background-color:\s*var\(--basis-button-background-hover,\s*var\(--basis-color-hover\)\)/)
    expect(css).toContain(
      'background-color: var(--basis-button-background-selected, ' +
      'var(--basis-color-selection))',
    )
    expect(css).toMatch(/background-color:\s*var\(--basis-button-background-focus,\s*var\(--basis-color-selection\)\)/)
    expect(css).toMatch(/border-color:\s*var\(--basis-button-border-color,\s*var\(--basis-color-focus\)\)/)
    expect(css).toContain(
      'background-color: var(--basis-button-background-disabled, ' +
      'var(--basis-color-disabled))',
    )
    expect(css).toMatch(/color:\s*var\(--basis-button-foreground-disabled,\s*var\(--basis-color-disabled-text\)\)/)
  })

  test('TextEditor resolves its surface, border, text, selection, and focus colours from its theme', () => {
    const css = block('.text-editor.component')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-text-editor-/)
    expect(css).toMatch(/background-color:\s*var\(--basis-text-editor-background,\s*var\(--basis-color-surface\)\)/)
    expect(css).toMatch(/color:\s*var\(--basis-text-editor-foreground,\s*var\(--basis-color-foreground\)\)/)
    expect(css).toMatch(new RegExp(
      'var\\(--basis-text-editor-border,\\s*1px solid ' +
      'var\\(--basis-text-editor-border-color,\\s*var\\(--basis-color-border\\)\\)\\)',
    ))
    expect(css).toContain('color: inherit')
    expect(css).toMatch(/background-color:\s*var\(--basis-color-selection\)/)
    expect(css).toMatch(/border-color:\s*var\(--basis-color-focus\)/)
  })

  test('NumberEditor follows the same theme-resolved surface contract as TextEditor', () => {
    const css = block('.number-editor.component')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-number-editor-/)
    expect(css).toMatch(/background-color:\s*var\(--basis-number-editor-background,\s*var\(--basis-color-surface\)\)/)
    expect(css).toMatch(/color:\s*var\(--basis-number-editor-foreground,\s*var\(--basis-color-foreground\)\)/)
    expect(css).toMatch(new RegExp(
      'var\\(--basis-number-editor-border,\\s*1px solid ' +
      'var\\(--basis-number-editor-border-color,\\s*var\\(--basis-color-border\\)\\)\\)',
    ))
  })

  test('PopupMenu uses elevated-surface semantic fallbacks instead of root-computed light values', () => {
    const css = block('.popup-menu.component')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--popup-menu-color-/)
    expect(css).toContain('var(--popup-menu-color-background, var(--basis-color-surface-elevated))')
    expect(css).toContain('var(--popup-menu-color-border, var(--basis-color-border))')
    expect(css).toContain('var(--popup-menu-color-foreground, var(--basis-color-foreground))')
  })

  test('Dialog uses the elevated surface, border, and foreground semantic tokens', () => {
    const css = block('.dialog.component')

    expect(css).toContain('background-color: var(--basis-color-surface-elevated)')
    expect(css).toContain('border: 1px solid var(--basis-color-border)')
    expect(css).toContain('color: var(--basis-color-foreground)')
  })

  test('Table resolves rows, headers, borders, and cells from the nearest theme', () => {
    const table = block('.table.editor.component')
    const cell = block('.table-cell.component')
    const header = block('.table-header-cell.component')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-table-/)
    expect(table).toContain('var(--basis-table-border-color, var(--basis-color-border-subtle))')
    expect(table).toContain('var(--basis-table-header-cell-background, var(--basis-color-primary))')
    expect(table).toContain('var(--basis-table-row-background-even, var(--basis-color-surface-alt))')
    expect(table).toContain('var(--basis-table-row-background-odd, var(--basis-color-surface))')

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-table-/)
    expect(cell).toContain('var(--basis-table-cell-background, transparent)')
    expect(cell).toContain('var(--basis-table-cell-foreground, var(--basis-color-foreground))')

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-table-/)
    expect(header).toContain('var(--basis-table-header-cell-foreground, var(--basis-color-contrast))')
  })

  test('ToggleEditor resolves unselected, hover, focus, and selected text from its theme', () => {
    const css = block('.toggle.editor')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-toggle-/)
    expect(css).toContain('background-color: var(--basis-toggle-background, var(--basis-color-surface))')
    expect(css).toContain('color: var(--basis-toggle-foreground, var(--basis-color-foreground))')
    expect(css).toContain('var(--basis-toggle-background-hover, var(--basis-color-hover))')
    expect(css).toContain('outline: 2px solid var(--basis-color-focus)')
    expect(css).toContain('var(--basis-toggle-background-on, var(--basis-color-primary))')
  })

  test('Menu items use the theme hover and selection states', () => {
    const css = block('.menu-item.component')

    expect(css).toContain('background-color: var(--basis-color-hover)')
    expect(css).toContain('background-color: var(--basis-color-selection)')
    expect(css).toContain('outline: 1px solid var(--basis-color-focus)')
  })

  test('Documentation chrome follows the active theme instead of hardcoded light colours', () => {
    const css = block('> nav.links')
    const all = styles()

    expect(css).toContain('background: var(--basis-color-surface-muted)')
    expect(css).toContain('border-right: 1px solid var(--basis-color-border-subtle)')
    expect(css).toContain('color: var(--basis-color-foreground)')
    expect(all).toContain("input:not(.value):not([type='checkbox'])")
    expect(css).not.toContain('#eee')
  })

  test('Tooltip and notification surfaces use the elevated theme token', () => {
    const tooltip = block('.tooltip.component')
    const notification = block('.notification.component')

    expect(tooltip).toContain('var(--tooltip-color-background, var(--basis-color-surface-elevated))')
    expect(notification).toContain('background-color: var(--basis-color-surface-elevated)')
  })

  test('PrefixSuffix inherits the theme inset surface and muted text', () => {
    const css = block('[data-has-prefix] > .prefix')
    const all = styles()

    expect(all).not.toMatch(/:root\s*{[^}]*--basis-prefix-suffix-/)
    expect(css).toContain('var(--basis-prefix-suffix-background, var(--basis-color-surface-inset))')
    expect(css).toContain('var(--basis-prefix-suffix-foreground, var(--basis-color-foreground-muted))')
  })
})

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
    expect(document.getElementById('basis:theme:dark')?.textContent).toContain('--basis-color-surface-elevated:')

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
    expect(document.getElementById('basis:theme:dark')?.textContent).toContain('--basis-color-surface-elevated:')

    rendered.unmount()
  })
})
