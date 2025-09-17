import * as React from 'react'
import { Editor } from '../Editor/Editor'

enum OptionType {
  Checkbox = 'checkbox',
  Radio = 'radio',
}

interface Props<T> {
  children?: React.ReactNode,
  data: T,
  disabled?: boolean,
  index?: number,
  onChange?: (selected: boolean, index: number, data: T) => void,
  readOnly?: boolean,
  type?: OptionType,
}

/**
 * Individual option component for use within an OptionGroup.
 * Extends the Editor base class to provide boolean state management.
 */
export class Option<T> extends Editor<boolean, HTMLLabelElement, Props<T>> {
  static displayName = 'OptionGroup.Option'
  static Type = OptionType

  static defaultProps = {
    ...super.defaultProps,
    readOnly: false,
  }

  override get tag(): 'label' { return 'label' }

  /**
   * Handles the change event from the input element.
   * @param event The change event.
   */
  private handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const { data, index, onChange } = this.props
    const checked = event.target.checked
    this.handleChange(checked)
    if (onChange && index !== undefined) {
      onChange(checked, index, data)
    }
  }

  override content(): React.ReactNode {
    const { children, data, disabled, index, type } = this.props
    const selected = this.current ?? false

    return (
      <>
        <input
          checked={selected}
          disabled={disabled || this.props.readOnly}
          name={String(index)}
          type={type}
          value={String(data)}
          onChange={this.handleInputChange}
        />
        {children}
      </>
    )
  }
}
