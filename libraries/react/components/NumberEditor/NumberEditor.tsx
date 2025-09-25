import * as React from 'react'
import { formatNumber, isNil } from '@basis/utilities'
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
 * Simple number input editor component that extends the Editor base class.
 */
export class NumberEditor extends Editor<number, HTMLInputElement, Props> {
  static displayName = 'NumberEditor'

  static get defaultProps() {
    return {
      ...super.defaultProps,
      step: 1,
    }
  }
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
      .add(Placeholder)
      .add(PrefixSuffix)
  }

  static sanitize(value: string | number): string {
    if (isNil(value) || String(value).trim() === '') return ''
    let str = String(value).trim()
    const isNegative = str.startsWith('-')
    // Remove all characters except digits and dots
    str = str.replace(/[^0-9.]/g, '')
    // Only keep the first decimal point, drop others
    const [intPart, ...decParts] = str.split('.')
    const decPart = decParts.length > 0 ? decParts.join('') : undefined
    const cleaned = decPart !== undefined ? `${intPart}.${decPart}` : intPart
    return isNegative ? `-${cleaned}` : cleaned
  }

  /**
   * Formats a number with comma separators.
   * @param value The number to format.
   * @returns The formatted string.
   */
  static formatNumber(value: string | number): string {
    const sanitized = NumberEditor.sanitize(value)

    // Handle empty string
    if (sanitized === '') return ''

    // Handle single decimal point
    if (sanitized === '.') return '.'

    // Split by decimal point
    const isNegative = sanitized.startsWith('-')
    const cleanValue = sanitized.replace('-', '')
    const hasDecimalPoint = cleanValue.includes('.')
    const [before = '0', after = ''] = cleanValue.split('.')

    // Format integer part with commas
    const formattedInteger = before.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

    // Handle decimal part
    let decimalPart = ''
    if (hasDecimalPoint) {
      decimalPart = after.length === 0 ? '.' : `.${after}`
    }

    return [
      isNegative ? '-' : '',
      formattedInteger,
      decimalPart,
    ].join('')
  }

  static getCursorPosition(input: HTMLInputElement): { prefix: string, selected: string, suffix: string } {
    const value = input.value
    const prefix = value.slice(0, input.selectionStart)
    const selected = value.slice(input.selectionStart, input.selectionEnd)
    const suffix = value.slice(input.selectionEnd)

    return {
      prefix: NumberEditor.sanitize(prefix),
      selected: NumberEditor.sanitize(selected),
      suffix: NumberEditor.sanitize(suffix),
    }
  }
  protected handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value) || 0
    this.handleChange(value)
  }

  protected handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const { step = 1 } = this.props
    this.props.onKeyDown(event)
    if (event.defaultPrevented) return

    if ([Keyboard.ArrowUp, Keyboard.ArrowDown].includes(event.key as Keyboard)) {
      event.preventDefault()
      const currentValue = this.current ?? 0
      const newValue = event.key === Keyboard.ArrowUp ? currentValue + step : currentValue - step
      this.handleChange(newValue)
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
        aria-invalid={this.props.invalid ? 'true' : 'false'}
        className="value"
        name={this.props.field}
        type="text"
        value={this.current ?? ''}
        onChange={this.handleInputChange}
        onKeyDown={this.handleKeyDown}
      />
    )

    return super.content(input)
  }
}
