import * as React from 'react'
import { noop } from '@basis/utilities'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import { Keyboard } from '../../types/Keyboard'
import type { Mixin } from '../../types/Mixin'
import type { Orientation } from '../../types/Orientation'
import { Component } from '../Component/Component'
import { Editor } from '../Editor/Editor'

import './OptionGroup.styles.ts'

export enum OptionType {
  Checkbox = 'checkbox',
  Radio = 'radio',
}

/** Props for individual options within the OptionGroup. */
interface OptionProps<T> {
  /** The content to display for this option */
  children: React.ReactNode,
  /** Whether this option is disabled */
  disabled?: boolean,
  /** The index of this option */
  index?: number,
  /** Change handler called with (selected, index, value) */
  onChange?: (selected: boolean, index: number, value: T) => void,
  /** Whether this option is currently selected */
  selected?: boolean,
  /** The type of input (radio or checkbox) */
  type?: OptionType.Radio | OptionType.Checkbox,
  /** The value for this option */
  value: T,
}

/** Props specific to option group editor. */
interface Props extends IAccessible, IFocusable {
  /** Whether multiple options can be selected */
  multiple?: boolean,
  /** Orientation of the option group */
  orientation?: Orientation,
}

/**
 * Individual option component for use within OptionGroup
 */
class Option<T> extends Component<OptionProps<T>, HTMLLabelElement> {
  static displayName = 'OptionGroup.Option'
  static get defaultProps() {
    return {
      ...super.defaultProps,
      onChange: noop,
      type: OptionType.Radio,
    }
  }

  override get attributes() {
    return {
      ...super.attributes,
      'data-index': this.props.index,
      'data-selected': this.props.selected,
      'data-type': this.props.type,
    }
  }
  override get classNames() { return super.classNames.add('option-group-item') }
  override get tag() { return 'label' as const }

  private handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const { index, onChange, value } = this.props
    if (onChange && index !== undefined) {
      onChange(e.target.checked, index, value)
    }
  }

  override content(): React.ReactNode {
    const { children, disabled, selected, type, value } = this.props

    return (
      <>
        <input
          checked={selected || false}
          disabled={disabled}
          type={type}
          value={String(value)}
          onChange={this.handleChange}
        />
        {children}
      </>
    )
  }
}

/**
 * Option group editor component that extends the Editor base class.
 * Renders either radio buttons (single selection) or checkboxes (multiple selection).
 */
export class OptionGroup<T> extends Editor<T | T[], HTMLFieldSetElement, Props> {
  static displayName = 'OptionGroup'
  static Option = Option

  static defaultProps = {
    ...super.defaultProps,
    multiple: false,
    orientation: 'vertical',
  }
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
  }

  private get set(): Set<T> {
    const value = this.current
    if (Array.isArray(value)) {
      return new Set(value)
    }
    if (value !== undefined && value !== null) {
      return new Set([value])
    }
    return new Set()
  }
  override get tag() { return 'fieldset' as const }

  /**
   * Handles option change from Option component
   * @param selected Whether the option is selected
   * @param index The index of the option
   * @param value The value of the option
   */
  private handleOptionChange = (selected: boolean, index: number, value: T): void => {
    const update = new Set(this.set)

    if (this.props.multiple) {
      // Multiple mode: add/remove from set
      if (selected) {
        update.add(value)
      } else {
        update.delete(value)
      }
      // Convert Set back to array for onChange
      this.handleChange(Array.from(update) as T[])
    } else {
      // Single mode: replace entire set with single selection
      update.clear()
      if (selected) {
        update.add(value)
      }
      // Convert Set back to single value for onChange
      this.handleChange(update.size > 0 ? Array.from(update)[0] : null as T | null)
    }
  }

  /**
   * Gets the index of the currently focused option
   * @returns The index of the focused option, or 0 if none focused
   */
  private getFocusedIndex(): number {
    const focusedInput = this.rootNode?.querySelector('.option-group-item:focus-within') as HTMLInputElement
    return Number.parseInt(focusedInput?.dataset?.index ?? '-1', 10)
  }

  /**
   * Gets the Option components from children
   * @returns Array of Option React elements
   */
  private get options(): React.ReactElement<OptionProps<T>>[] {
    return React.Children.toArray(this.props.children)
      .filter(child => React.isValidElement(child) && child.type === OptionGroup.Option)
      .map(child => child as React.ReactElement<OptionProps<T>>)
  }

  /**
   * Handles keyboard navigation within the option group
   * @param event The keyboard event
   */
  #handleKeyDown = (event: React.KeyboardEvent<HTMLFieldSetElement>): void => {
    const optionElements = this.options
    const current = this.getFocusedIndex()
    let index = current

    switch (event.key) {
      case Keyboard.ArrowDown:
      case Keyboard.ArrowRight:
        event.preventDefault()
        index = (current + 1) % optionElements.length
        break
      case Keyboard.ArrowUp:
      case Keyboard.ArrowLeft:
        event.preventDefault()
        index = (current - 1 + optionElements.length) % optionElements.length
        break
      case Keyboard.Home:
        event.preventDefault()
        index = 0
        break
      case Keyboard.End:
        event.preventDefault()
        index = optionElements.length - 1
        break
      case Keyboard.Space: {
        event.preventDefault()
        const option = optionElements[current]
        if (option) {
          this.handleOptionChange(!this.set.has(option.props.value), current, option.props.value)
        }
        break
      }
    }

    if (index !== current) {
      const option = optionElements[index]
      if (option && !option.props.disabled) {
        if (!this.props.multiple) {
          // In single mode, select the new option (deselect others)
          this.handleOptionChange(true, index, option.props.value)
        }
        // Focus the input element
        const input = this.rootNode.querySelector(`.option-group-item[data-index="${index}"] input`) as HTMLInputElement
        input?.focus()
      }
    }
  }

  override get attributes() {
    return {
      ...super.attributes,
      'aria-label': this.props['aria-label'],
      'aria-labelledby': this.props['aria-labelledby'],
      'data-multiple': String(this.props.multiple),
      'data-orientation': this.props.orientation,
      'onKeyDown': this.#handleKeyDown,
      'role': this.props.multiple ? 'group' : 'radiogroup',
      'tabIndex': this.props.readOnly ? -1 : 0,
    }
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as text representation of selected values.
   */
  readOnly(): React.ReactNode {
    const optionElements = this.options
    const selectedOptions = optionElements.filter(opt => this.set.has(opt.props.value))
    const labels = selectedOptions.map(opt => String(opt.props.children))

    return (
      <span className="value">
        {labels.join(this.props.multiple ? ', ' : '')}
      </span>
    )
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const { multiple } = this.props
    return this.options.map(({ props: option }, index) => (
      <Option<T>
        key={index}
        disabled={option.disabled || this.props.readOnly}
        index={index}
        selected={this.set.has(option.value)}
        type={multiple ? OptionType.Checkbox : OptionType.Radio}
        value={option.value}
        onChange={this.handleOptionChange}
      >
        {option.children}
      </Option>
    ))
  }
}
