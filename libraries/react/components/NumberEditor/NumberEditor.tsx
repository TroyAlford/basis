import type * as React from 'react'
import { FormField } from '../FormField/FormField'

/**
 * Number input editor component that extends the FormField base class.
 * Handles number formatting with comma separators.
 */
export class NumberEditor
  extends FormField<number, HTMLInputElement> {
  /**
   * Formats a number with comma separators.
   * @param value The number to format.
   * @returns The formatted string.
   */
  private formatNumber(value: number): string {
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
    return this.current === 0 ? '' : this.formatNumber(this.current)
  }

  /**
   * Gets additional input attributes for number parsing.
   * @returns Additional input attributes.
   */
  protected get inputAttributes(): Record<string, unknown> {
    return {
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        const numberValue = this.parseNumber(value)
        this.handleChange(numberValue)
      },
    }
  }
}
