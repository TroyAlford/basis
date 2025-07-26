import * as React from 'react'
import { isNil } from '@basis/utilities'
import { prefixObject } from '../../utilities/prefixObject'
import type { ComponentProps } from '../Component/Component'
import { Editor } from '../Editor/Editor'

/**
 * Props for form field components.
 */
export interface FormFieldProps extends ComponentProps<HTMLDivElement> {
  /** Whether to enable browser autocomplete for the input field. @default false */
  autoComplete?: boolean,
  /** Whether to automatically focus the input when the component mounts. @default false */
  autoFocus?: boolean,
  /** ID of the element that describes this input (help text). */
  describedBy?: string,
  /** Whether the input field is disabled. @default false */
  disabled?: boolean,
  /** ID of the element that contains error messages for this input. */
  errorMessage?: string,
  /** Whether the input has a popup (dropdown, suggestions, etc.). */
  hasPopup?: boolean | 'dialog' | 'grid' | 'listbox' | 'menu' | 'tree',
  /** Whether the input has validation errors. @default false */
  invalid?: boolean,
  /** ARIA label for the input field (for screen readers). */
  label?: string,
  /** ID of the element that labels this input. */
  labelledBy?: string,
  /** Callback function called when the input receives focus. */
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void,
  /** Callback function called when a key is pressed while the input has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void,
  /** Placeholder text displayed when the input is empty. */
  placeholder?: string,
  /** Content to render before the input field. */
  prefix?: React.ReactNode,
  /** Whether the input field is read-only. @default false */
  readOnly?: boolean,
  /** Whether the input field is required. @default false */
  required?: boolean,
  /** Content to render after the input field. */
  suffix?: React.ReactNode,
  /** Tab index for keyboard navigation. @default 0 */
  tabIndex?: number,
}

/**
 * Props for form field components including Editor's typed props.
 */
type Props<Value> = FormFieldProps & {
  initialValue?: Value,
  onChange?: (value: Value, field: number | string, editor: unknown) => void,
  value?: Value,
}

/**
 * Base class for form field components that extends the Editor class.
 * Handles common form field behavior like prefix/suffix, validation states,
 * and form field styling.
 */
export abstract class FormField<
  Value = string,
  Element extends HTMLElement = HTMLDivElement,
  State extends Record<string, unknown> = Record<string, unknown>,
> extends Editor<Value, Element, Props<Value>, State> {
  /** Default props for form field components. */
  static defaultProps: Partial<FormFieldProps> = {
    ...super.defaultProps,
    autoComplete: false,
    autoFocus: false,
    disabled: false,
    invalid: false,
    readOnly: false,
    required: false,
    tabIndex: 0,
  }

  /**
   * Automatically derived display name from constructor.
   * @returns The display name.
   */
  static get displayName(): string {
    return this.name
  }

  /** Reference to the underlying HTML input element. */
  protected inputRef = React.createRef<HTMLInputElement>()

  /**
   * Gets the initial state for the component.
   * @returns The initial state.
   */
  get defaultState(): State & { current: Value } {
    return {
      ...super.defaultState,
      current: this.props.value ?? this.props.initialValue ?? ('' as Value),
    }
  }

  /**
   * Gets ARIA attributes for accessibility.
   * @returns The ARIA attributes.
   */
  get aria(): Record<string, string> {
    return {
      ...super.aria,
      autocomplete: this.props.autoComplete ? 'on' : 'off',
      describedby: this.props.describedBy,
      disabled: this.props.disabled ? 'true' : 'false',
      errormessage: this.props.errorMessage,
      haspopup: this.props.hasPopup ? String(this.props.hasPopup) : undefined,
      invalid: this.props.invalid ? 'true' : 'false',
      label: this.props.label,
      labelledby: this.props.labelledBy,
      placeholder: this.props.placeholder,
      readonly: this.props.readOnly ? 'true' : 'false',
      required: this.props.required ? 'true' : 'false',
    }
  }

  /**
   * Gets HTML attributes for the container element.
   * @returns The HTML attributes.
   */
  get attributes(): Record<string, string | undefined> {
    return {
      ...super.attributes,
      disabled: this.props.disabled ? 'disabled' : undefined,
      readOnly: this.props.readOnly ? 'readOnly' : undefined,
    }
  }

  /**
   * Gets data attributes for state management.
   * @returns The data attributes.
   */
  get data(): Record<string, unknown> {
    return {
      ...super.data,
      'has-prefix': this.props.prefix ? true : undefined,
      'has-suffix': this.props.suffix ? true : undefined,
    }
  }

  /**
   * Handles input focus events.
   * @param event The focus event.
   */
  protected handleInputFocus = (event: React.FocusEvent<HTMLInputElement>): void => {
    const { onFocus } = this.props
    onFocus?.(event)
  }

  /**
   * Handles input key down events.
   * @param event The key down event.
   */
  protected handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const { onKeyDown } = this.props
    onKeyDown?.(event)
  }

  /** Focuses the input element. */
  focus(): void {
    this.inputRef.current?.focus()
  }

  /** Removes focus from the input element. */
  blur(): void {
    this.inputRef.current?.blur()
  }

  /** Selects all text in the input element. */
  select(): void {
    this.inputRef.current?.select()
  }

  /**
   * Gets the input value to display.
   * @returns The input value.
   */
  protected get inputValue(): string {
    return String(this.current)
  }

  /**
   * Gets the input type for the form field.
   * @returns The input type.
   */
  protected get inputType(): string {
    return 'text'
  }

  /**
   * Gets additional input attributes specific to the form field.
   * @returns Additional input attributes.
   */
  protected get inputAttributes(): Record<string, unknown> {
    return {}
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    return (
      <>
        {!isNil(this.props.prefix) && (
          <div className="prefix">
            {this.props.prefix}
          </div>
        )}
        <input
          ref={this.inputRef}
          autoComplete={this.props.autoComplete ? 'on' : 'off'}
          autoFocus={this.props.autoFocus}
          disabled={this.props.disabled}
          name={String(this.props.field)}
          placeholder={this.props.placeholder}
          readOnly={this.props.readOnly}
          required={this.props.required}
          role="textbox"
          tabIndex={this.props.tabIndex}
          type={this.inputType}
          value={this.inputValue}
          onFocus={this.handleInputFocus}
          onKeyDown={this.handleInputKeyDown}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const value = event.target.value
            this.handleChange(value as Value)
          }}
          {...this.inputAttributes}
          {...prefixObject('aria-', this.aria)}
        />
        {!isNil(this.props.suffix) && (
          <div className="suffix">
            {this.props.suffix}
          </div>
        )}
      </>
    )
  }
}
