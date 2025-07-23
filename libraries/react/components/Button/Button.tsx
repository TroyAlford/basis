import type * as React from 'react'
import { match, noop } from '@basis/utilities'
import { Component } from '../Component/Component'
import './Button.scss'

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
 */
export class Button extends Component<Props, HTMLButtonElement> {
  static readonly Type = ButtonType
  static defaultProps: Partial<Component<Props>['props']> = {
    disabled: false,
    onActivate: noop,
    type: ButtonType.Button,
  }

  get aria(): Record<string, boolean | number | string> {
    return {
      ...super.aria,
      'aria-disabled': !!this.props.disabled,
    }
  }

  get attributes(): React.ButtonHTMLAttributes<HTMLButtonElement> {
    const { disabled, type } = this.props
    return {
      disabled: !!disabled,
      onKeyDown: this.handleActivate,
      onPointerDown: this.handleActivate,
      type,
    }
  }

  get tag(): keyof React.ReactHTML { return 'button' }

  /**
   * Handles all activation events (key, pointer).
   * @param event - The synthetic event.
   */
  private handleActivate = (event: React.SyntheticEvent): void => {
    const { disabled, onActivate } = this.props
    if (disabled) return

    match(event.type)
      .when('keydown').then(() => {
        const { key } = event as React.KeyboardEvent
        if (!['Enter', ' '].includes(key)) return
        onActivate(event)
      })
      .when('pointerdown').then(() => {
        const { button } = event as React.PointerEvent
        if (button !== 0) return
        onActivate(event)
      })
      .else(noop)
  }
}
