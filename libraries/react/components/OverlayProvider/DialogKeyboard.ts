import { isValidElement } from 'react'
import { Intent } from '../../types/Intent'
import type { DialogButton } from './Dialog'

/**
 * Whether a dialog button definition represents cancel / dismiss.
 * @param button - Footer button from {@link Dialog.open}.
 * @returns True when the button resolves `false`.
 */
export function isDialogCancelButton(button: DialogButton<unknown>): boolean {
  if (isValidElement(button)) return button.props['data-value'] === false
  if ('value' in button) return button.value === false
  return false
}

/**
 * Whether a dialog button is styled as the primary/default action.
 * @param button - Footer button from {@link Dialog.open}.
 * @returns True for primary, success, or danger intent.
 */
export function isDialogPrimaryButton(button: DialogButton<unknown>): boolean {
  if (isValidElement(button)) {
    const intent = button.props['data-intent'] ?? Intent.Default
    return intent === Intent.Primary || intent === Intent.Success || intent === Intent.Danger
  }
  const intent = button.intent ?? Intent.Default
  return intent === Intent.Primary || intent === Intent.Success || intent === Intent.Danger
}

/**
 * Index of the footer button Escape should activate, or null when there is no cancel action.
 * @param buttons - Dialog footer buttons.
 * @returns Button index, or null when Escape should dismiss without a footer button.
 */
export function dialogCancelButtonIndex(buttons: DialogButton<unknown>[]): number | null {
  const cancel = buttons
    .map((button, index) => ({ button, index }))
    .filter(({ button }) => isDialogCancelButton(button))

  if (cancel.length === 1) return cancel[0].index

  return null
}

/**
 * Index of the footer button Enter should activate, or null when ambiguous.
 * @param buttons - Dialog footer buttons.
 * @returns Button index, or null when Enter should not confirm.
 */
export function dialogDefaultButtonIndex(buttons: DialogButton<unknown>[]): number | null {
  const nonCancel = buttons
    .map((button, index) => ({ button, index }))
    .filter(({ button }) => !isDialogCancelButton(button))

  if (nonCancel.length === 1) return nonCancel[0].index

  const primary = nonCancel.filter(({ button }) => isDialogPrimaryButton(button))
  if (primary.length === 1) return primary[0].index

  const affirmative = nonCancel.filter(({ button }) => (
    !isValidElement(button) && 'value' in button && button.value === true
  ))
  if (affirmative.length === 1) return affirmative[0].index

  return null
}
