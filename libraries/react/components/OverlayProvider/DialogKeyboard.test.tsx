import { describe, expect, test } from 'bun:test'
import { Intent } from '../../types/Intent'
import { Button } from '../Button/Button'
import { dialogCancelButtonIndex, dialogDefaultButtonIndex, isDialogCancelButton } from './DialogKeyboard.ts'

describe('DialogKeyboard', () => {
  test('isDialogCancelButton detects cancel footer buttons', () => {
    expect(isDialogCancelButton({ label: 'Cancel', value: false })).toBe(true)
    expect(isDialogCancelButton(<Button data-value={false}>Cancel</Button>)).toBe(true)
    expect(isDialogCancelButton(<Button data-value={true}>OK</Button>)).toBe(false)
  })

  test('dialogCancelButtonIndex picks the sole cancel button', () => {
    const buttons = [
      { intent: Intent.Primary, label: 'OK', value: true },
      { label: 'Cancel', value: false },
    ]
    expect(dialogCancelButtonIndex(buttons)).toBe(1)
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
