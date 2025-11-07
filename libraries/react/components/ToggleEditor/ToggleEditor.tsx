import type * as React from 'react'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import type { Mixin } from '../../types/Mixin'
import { Editor } from '../Editor/Editor'

import './ToggleEditor.styles.ts'

/** Props specific to toggle editor. */
interface Props extends IAccessible, IFocusable {
  /** The children of the component. If on/off are provided, they take precedence over children in the related state. */
  children?: React.ReactNode,
  /** The data value for this toggle */
  data?: unknown,
  /** Whether the toggle is disabled */
  disabled?: boolean,
  /** Content to display when toggle is off */
  off?: React.ReactNode,
  /** Content to display when toggle is on */
  on?: React.ReactNode,
}

/**
 * Toggle editor component that extends the Editor base class.
 * Renders a clickable toggle with optional icons and text.
 */
export class ToggleEditor extends Editor<boolean, HTMLButtonElement, Props> {
  static displayName = 'ToggleEditor'
  static defaultProps = {
    ...super.defaultProps,
    off: undefined,
    on: undefined,
  }
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
  }

  /**
   * Handles toggle state change
   */
  #handleClick = (): void => {
    if (!this.props.readOnly) {
      this.handleChange(!this.current)
    }
  }

  /**
   * Handles keyboard activation (Space/Enter)
   * @param event The keyboard event
   */
  #handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      this.#handleClick()
    }
  }

  override get attributes() {
    const currentValue = this.current ?? false
    return {
      ...super.attributes,
      'aria-pressed': String(currentValue),
      'data-state': currentValue ? 'on' : 'off',
      'disabled': this.props.readOnly || this.props.disabled || undefined,
      'onClick': this.props.readOnly ? undefined : this.#handleClick,
      'onKeyDown': this.props.readOnly ? undefined : this.#handleKeyDown,
      'tabIndex': this.props.readOnly ? -1 : 0,
    }
  }
  override get classNames(): Set<string> { return super.classNames.add('toggle') }
  override get tag(): 'button' { return 'button' }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const { children, off, on } = this.props
    const currentValue = this.current ?? false

    return super.content(
      currentValue
        ? on ?? children ?? 'On'
        : off ?? children ?? 'Off',
    )
  }
}
