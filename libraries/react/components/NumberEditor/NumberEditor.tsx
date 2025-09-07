import * as React from 'react'
import { formatNumber } from '@basis/utilities'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import type { IPlaceholder } from '../../mixins/Placeholder'
import { Placeholder } from '../../mixins/Placeholder'
import type { IPrefixSuffix } from '../../mixins/PrefixSuffix'
import { PrefixSuffix } from '../../mixins/PrefixSuffix'
import { Keyboard } from '../../types/Keyboard'
import type { Mixin } from '../../types/Mixin'
import { Editor } from '../Editor/Editor'

import './NumberEditor.styles.ts'

/** Props specific to number editor. */
interface Props extends IAccessible, IPrefixSuffix, IPlaceholder, IFocusable {
  /** Step value for up/down arrow keys. If provided, arrow keys will adjust the value by this amount. */
  step?: number,
}

/**
 * Number input editor component that extends the Editor base class.
 * Handles number formatting with comma separators.
 */
export class NumberEditor extends Editor<number, HTMLInputElement, Props> {
  static displayName = 'NumberEditor'
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
      .add(Placeholder)
      .add(PrefixSuffix)
  }

  /**
   * Formats a number with comma separators.
   * @param value The number to format.
   * @returns The formatted string.
   */
  private formatNumber(value: number | null): string {
    if (value === null || value === undefined) return ''
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  /**
   * Parses a formatted number string back to a number.
   * @param value The formatted string to parse.
   * @returns The parsed number.
   */
  private parseNumber(value: string): number {
    const cleanValue = value.replace(/,/g, '')
    return cleanValue === '' ? 0 : parseInt(cleanValue, 10)
  }

  /**
   * Gets the input value to display with number formatting.
   * @returns The formatted input value.
   */
  protected get inputValue(): string {
    if (this.current === null || this.current === undefined) return ''
    return this.current === 0 ? '' : this.formatNumber(this.current)
  }

  #handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    const numberValue = this.parseNumber(value)
    this.handleChange(numberValue)
  }

  protected handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const { step } = this.props

    // Call the base class handleKeyDown first
    super.handleKeyDown(event)

    // Check if step should be applied (only if step is provided and arrow keys are pressed)
    if (step && ([Keyboard.ArrowUp, Keyboard.ArrowDown].includes(event.key as Keyboard))) {
      // Don't apply step if default was prevented
      if (!event.defaultPrevented) {
        event.preventDefault()

        const currentValue = this.current ?? 0
        const newValue = event.key === Keyboard.ArrowUp
          ? currentValue + step
          : currentValue - step

        this.handleChange(newValue)
      }
    }
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as nicely formatted number.
   */
  readOnly(): React.ReactNode {
    const value = this.current
    if (value === null || value === undefined) return ''
    return formatNumber(value, { grouping: true, locale: 'en-US' })
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const input = (
      <input
        className="value"
        name={this.props.field}
        type="text"
        value={this.inputValue}
        onChange={this.#handleChange}
        onKeyDown={this.handleKeyDown}
      />
    )

    return super.content(input)
  }
}
