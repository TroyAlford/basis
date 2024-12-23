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
  type?: 'button' | 'submit' | 'reset',
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
  readonly tag: keyof React.ReactHTML = 'button'
  static defaultProps: Partial<Component<Props>['props']> = {
    disabled: false,
    onActivate: noop,
    type: 'button',
  }

  get attributes(): React.ButtonHTMLAttributes<HTMLButtonElement> {
    const { disabled, type } = this.props
    return {
      disabled: !!disabled,
      onClick: this.handleActivate,
      onKeyDown: this.handleActivate,
      onPointerDown: this.handleActivate,
      onTouchStart: this.handleActivate,
      type,
    }
  }

  get aria(): Record<string, boolean | number | string> {
    return {
      ...super.aria,
      'aria-disabled': !!this.props.disabled,
    }
  }

  get classNames(): Set<string> {
    return super.classNames
      .add('button')
      .add(this.props.disabled ? 'disabled' : 'enabled')
  }

  /**
   * Handles all activation events (click, key, pointer, touch).
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
      .when('click').or('pointerdown').then(() => {
        const { button } = event as React.PointerEvent
        if (button !== 0) return
        onActivate(event)
      })
      .when('touchstart').then(() => onActivate(event))
      .else(noop)
  }
}
