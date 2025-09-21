import * as React from 'react'
import { match } from '@basis/utilities/index.ts'
import { Square } from '../../icons/Square'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import type { Mixin } from '../../types/Mixin'
import { Editor } from '../Editor/Editor'

import './CheckboxEditor.styles.ts'

/** Props specific to checkbox editor. */
interface Props extends IAccessible, IFocusable {
  /** Whether to allow indeterminate state. @default false */
  allowIndeterminate?: boolean,
  /** The children of the component. */
  children?: React.ReactNode,
}

/**
 * Checkbox editor component that extends the Editor base class.
 * Uses a hidden checkbox with custom square icons for display.
 */
export class CheckboxEditor extends Editor<boolean | null, HTMLLabelElement, Props> {
  static displayName = 'CheckboxEditor'
  static get defaultProps() {
    return {
      ...super.defaultProps,
      allowIndeterminate: false,
    }
  }
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
  }

  #checkbox = React.createRef<HTMLInputElement>()

  #handleChange = () => {
    const { allowIndeterminate } = this.props
    const currentValue = this.current

    if (!allowIndeterminate) {
      // Simple true/false toggle
      this.handleChange(!currentValue)
    } else {
      // Three-state cycle: true -> false -> null -> true
      if (currentValue === true) {
        this.handleChange(false)
      } else if (currentValue === false) {
        this.handleChange(null)
      } else {
        // currentValue === null
        this.handleChange(true)
      }
    }
  }

  override get tag() { return 'label' as const }

  override get attributes() {
    return {
      ...super.attributes,
      'data-checked': String(this.current === true),
      'data-indeterminate': String(this.current === null),
      'disabled': this.props.disabled || undefined,
    }
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const value = this.current
    let icon: React.ReactNode

    if (value === true) {
      icon = <Square.Check />
    } else if (value === false) {
      icon = <Square.X />
    } else {
      // value === null
      icon = <Square.Dash />
    }

    const ariaChecked = match(value)
      .when(null).then('mixed' as const)
      .when(true).then('true' as const)
      .else('false' as const)

    const checkbox = (
      <input
        ref={this.#checkbox}
        aria-checked={ariaChecked}
        aria-describedby={this.props.describedBy}
        aria-invalid={this.props.invalid ? 'true' : 'false'}
        aria-label={this.props.label}
        aria-labelledby={this.props.labelledBy}
        checked={value === true}
        name={this.props.field}
        type="checkbox"
        onChange={this.#handleChange}
      />
    )

    return super.content(
      <>
        {checkbox}
        {icon}
        {this.props.children}
      </>,
    )
  }

  componentDidMount(): void {
    super.componentDidMount?.()
    this.updateCheckboxIndeterminate()
  }

  componentDidUpdate(prevProps, prevState): void {
    super.componentDidUpdate(prevProps, prevState)
    this.updateCheckboxIndeterminate()
  }

  private updateCheckboxIndeterminate(): void {
    const checkbox = this.#checkbox.current
    if (checkbox) {
      checkbox.indeterminate = this.current === null
    }
  }
}
