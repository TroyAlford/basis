import type * as React from 'react'
import { match, noop } from '@basis/utilities'
import { Keyboard } from '../../types/Keyboard'
import { Component } from '../Component/Component'

import './Button.styles.ts'

enum ButtonType {
  Button = 'button',
  Reset = 'reset',
  Submit = 'submit',
}

/** Props for the Button component. */
interface Props {
  /** Whether the button is disabled. */
  disabled?: boolean,
  /** The handler for the unified activation event. */
  onActivate?: (event: React.SyntheticEvent) => void,
  /** The type of the button. */
  type?: ButtonType,
}

/**
 * A button component that provides a unified interaction pattern.
 * @example
 * <Button onActivate={event => console.log('Button activated!')}>
 *   Click me
 * </Button>
 * @example
 * // Using data attributes with a single handler (recommended pattern)
 * <Button data-value="option1" onActivate={handleButton}>Option 1</Button>
 * <Button data-value="option2" onActivate={handleButton}>Option 2</Button>
 *
 * // With handler that reads data-value:
 * handleButton = (event: React.SyntheticEvent): void => {
 *   const target = event.currentTarget as HTMLButtonElement
 *   const value = target.dataset.value
 *   // Handle based on value
 * }
 */
export class Button extends Component<Props, HTMLButtonElement> {
  static readonly Type = ButtonType

  static displayName = 'Button'
  static defaultProps: Partial<Component<Props>['props']> = {
    disabled: false,
    onActivate: noop,
    type: ButtonType.Button,
  }

  get attributes() {
    const { disabled, type } = this.props
    return {
      ...super.attributes,
      'aria-disabled': !!disabled,
      'disabled': !!disabled,
      'onClick': this.handleActivate,
      'onKeyDown': this.handleActivate,
      'type': type,
    }
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'button' }

  /**
   * Handles all activation events (click, key).
   * @param event - The synthetic event.
   */
  private handleActivate = (event: React.SyntheticEvent): void => {
    const { disabled, onActivate } = this.props
    if (disabled) return

    const handled = match(event.type)
      .when('click').then(() => {
        onActivate(event)
        return true
      })
      .when('keydown').then(() => {
        const { key } = event as React.KeyboardEvent
        if (![Keyboard.Enter, Keyboard.Space].includes(key as Keyboard)) return false

        onActivate(event)
        return true
      })
      .else(noop)

    if (!handled) return
    event.preventDefault()
    event.stopPropagation()
  }
}
