import { describe, expect, test } from 'bun:test'
import { Intent } from '../../types/Intent'
import { Keyboard } from '../../types/Keyboard'
import { Button } from '../Button/Button'
import { dialogDefaultButtonIndex, dialogEnterConfirms, isDialogCancelButton } from './DialogKeyboard.ts'

/**
 * Minimal keyboard event stub for {@link DialogKeyboard} unit tests.
 * @param target - Event target element.
 * @param key - Key value.
 * @param options - Optional event flags.
 * @param options.defaultPrevented - Whether the event was already prevented.
 * @returns A React keyboard event-shaped object.
 */
function keydown(
  target: HTMLElement,
  key: Keyboard,
  options: { defaultPrevented?: boolean } = {},
): React.KeyboardEvent<HTMLElement> {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: options.defaultPrevented ?? false,
    key,
    metaKey: false,
    shiftKey: false,
    target,
  } as unknown as React.KeyboardEvent<HTMLElement>
}

describe('DialogKeyboard', () => {
  test('dialogEnterConfirms accepts Enter on a single-line TextEditor input', () => {
    const input = document.createElement('input')
    input.className = 'value'
    const editor = document.createElement('div')
    editor.className = 'text-editor component'
    editor.dataset.multiline = 'false'
    editor.append(input)

    expect(dialogEnterConfirms(keydown(input, Keyboard.Enter))).toBe(true)
  })

  test('dialogEnterConfirms rejects Enter on multiline TextEditor', () => {
    const textarea = document.createElement('textarea')
    const editor = document.createElement('div')
    editor.className = 'text-editor component'
    editor.dataset.multiline = 'true'
    editor.append(textarea)

    expect(dialogEnterConfirms(keydown(textarea, Keyboard.Enter))).toBe(false)
  })

  test('dialogEnterConfirms rejects Enter when defaultPrevented', () => {
    const input = document.createElement('input')
    expect(dialogEnterConfirms(keydown(input, Keyboard.Enter, { defaultPrevented: true }))).toBe(false)
  })

  test('isDialogCancelButton detects cancel footer buttons', () => {
    expect(isDialogCancelButton({ label: 'Cancel', value: false })).toBe(true)
    expect(isDialogCancelButton(<Button data-value={false}>Cancel</Button>)).toBe(true)
    expect(isDialogCancelButton(<Button data-value={true}>OK</Button>)).toBe(false)
  })

  test('dialogDefaultButtonIndex picks the sole non-cancel button', () => {
    const buttons = [
      { label: 'Cancel', value: false },
      { intent: Intent.Primary, label: 'OK', value: true },
    ]
    expect(dialogDefaultButtonIndex(buttons)).toBe(1)
  })

  test('dialogDefaultButtonIndex returns null when non-cancel actions are ambiguous', () => {
    const buttons = [
      { label: 'X', value: 'x' },
      { label: 'Y', value: 'y' },
    ]
    expect(dialogDefaultButtonIndex(buttons)).toBe(null)
  })
})
