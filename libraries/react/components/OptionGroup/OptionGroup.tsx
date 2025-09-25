import * as React from 'react'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import { Keyboard } from '../../types/Keyboard'
import type { Mixin } from '../../types/Mixin'
import type { Orientation } from '../../types/Orientation'
import { Editor } from '../Editor/Editor'
import { Option } from './Option'

import './OptionGroup.styles.ts'

/** Props for the OptionGroup component. */
interface Props extends IAccessible, IFocusable {
  /** The children of the component. */
  children?: React.ReactNode,
  /** Whether multiple options can be selected */
  multiple?: boolean,
  /** The orientation of the options */
  orientation?: Orientation,
  /** The current value(s) */
  value?: unknown | unknown[],
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
    return value !== undefined && value !== null ? new Set([value]) : new Set()
  }

  /**
   * Handles the change event for an individual option.
   * @param selected Whether the option is selected.
   * @param index The index of the option.
   * @param data The data value of the option.
   */
  private handleOptionChange = (selected: boolean, index: number, data: T): void => {
    const { multiple } = this.props
    const update = new Set(this.set)

    if (multiple) {
      if (selected) {
        update.add(data)
      } else {
        update.delete(data)
      }
      this.handleChange(Array.from(update))
    } else {
      update.clear()
      if (selected) {
        update.add(data)
      }
      // Convert Set back to single value for onChange
      this.handleChange(update.size > 0 ? Array.from(update)[0] : null as T | null)
    }
  }

  private focusOptionElement = (optionElements: NodeListOf<Element>, index: number): boolean => {
    const targetOptionElement = optionElements[index] as HTMLElement
    if (!targetOptionElement) return false

    // Focus the root element directly (it should be focusable)
    if (targetOptionElement.focus) {
      targetOptionElement.focus()
      return true
    }
    return false
  }

  #handleKeyDown = (event: React.KeyboardEvent<HTMLFieldSetElement>): void => {
    // Handle the onKeyDown prop manually (like the base class does)
    const { onKeyDown } = this.props
    onKeyDown(event)

    /*
     * CRITICAL: Use event.currentTarget (the fieldset) instead of this.rootNode
     * This ensures we're always working with the correct fieldset element
     */
    const fieldset = event.currentTarget as HTMLFieldSetElement

    const role = '[data-role="OptionGroup.Option"]'
    const focused = fieldset.querySelector(`${role}:focus, ${role}:focus-within`)
    if (!focused) return

    // Get all OptionGroup.Option elements WITHIN THIS FIELDSET ONLY
    const options = fieldset.querySelectorAll(role)
    const currentIndex = Array.from(options).indexOf(focused)
    if (currentIndex === -1) return

    // ONLY handle navigation keys - let individual components handle selection
    let handled = false
    if ([Keyboard.ArrowDown, Keyboard.ArrowRight].includes(event.key as Keyboard)) {
      const targetIndex = (currentIndex + 1) % options.length
      handled = this.focusOptionElement(options, targetIndex)
    } else if ([Keyboard.ArrowUp, Keyboard.ArrowLeft].includes(event.key as Keyboard)) {
      const targetIndex = (currentIndex - 1 + options.length) % options.length
      handled = this.focusOptionElement(options, targetIndex)
    } else if (event.key === Keyboard.Home) {
      handled = this.focusOptionElement(options, 0)
    } else if (event.key === Keyboard.End) {
      handled = this.focusOptionElement(options, options.length - 1)
    }
    // Do NOT handle Space/Enter - let individual components handle their own selection

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    } else if (!event.defaultPrevented) {
      event.preventDefault()
    }
  }

  get array(): T[] { return Array.from(this.set) }
  get selected(): T | null {
    const array = this.array
    return array.length > 0 ? array[0] : null
  }

  /**
   * Gets the Editor<boolean> components from children
   * @returns Array of Editor React elements
   */
  get options(): React.ReactElement[] {
    return React.Children.toArray(this.props.children)
      .filter(child => React.isValidElement(child))
  }

  /**
   * Extracts the data value from an Editor<boolean> component
   * @param option The option element
   * @returns The data value or undefined
   */
  private getOptionData(option: React.ReactElement): T | undefined {
    // For Option components, get the data prop
    if (option.type === OptionGroup.Option) {
      return (option.props as { data?: T }).data
    }
    // For other Editor<boolean> components (like ToggleEditor), get the data prop
    return (option.props as { data?: T }).data
  }

  /**
   * Checks if an option is currently selected.
   * @param option The option element.
   * @returns True if the option is selected, false otherwise.
   */
  private isOptionSelected(option: React.ReactElement): boolean {
    const data = this.getOptionData(option)
    return data !== undefined && this.set.has(data)
  }

  override get tag(): 'fieldset' { return 'fieldset' }

  override get attributes() {
    return {
      ...super.attributes,
      'aria-label': this.props['aria-label'],
      'aria-labelledby': this.props['aria-labelledby'],
      'data-multiple': String(this.props.multiple),
      'data-orientation': this.props.orientation,
      'onKeyDown': this.#handleKeyDown,
      'role': this.props.multiple ? 'group' : 'radiogroup',
      'tabIndex': -1,
    }
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as text representation of selected values.
   */
  readOnly(): React.ReactNode {
    const optionElements = this.options
    const selectedOptions = optionElements.filter(opt => this.isOptionSelected(opt))

    if (selectedOptions.length === 0) {
      return null
    }

    return selectedOptions.map(opt => {
      // For OptionGroup.Option, render its children
      if (opt.type === OptionGroup.Option) {
        return (opt.props as { children?: React.ReactNode }).children
      }
      /*
       * For other Editor<boolean> components, render their readOnly content if available
       * This assumes other editors have a readOnly method or a prop to display read-only state
       */
      const optProps = (opt as React.ReactElement<Record<string, unknown>>).props
      return optProps.readOnlyContent || String(this.getOptionData(opt))
    }).join(', ')
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const { multiple } = this.props
    return this.options.map((option, index) => {
      const data = this.getOptionData(option)
      const isSelected = data !== undefined ? this.set.has(data) : false

      // Clone the option element and add necessary props
      return React.cloneElement(option as React.ReactElement<Record<string, unknown>>, {
        ...(option.props as Record<string, unknown>),
        data,
        'data-role': 'OptionGroup.Option',
        index,
        'key': index,
        'onChange': (selected: boolean) => {
          if (data !== undefined) {
            this.handleOptionChange(selected, index, data)
          }
        },
        'readOnly': this.props.readOnly,
        'type': option.type === OptionGroup.Option ? (multiple ? Option.Type.Checkbox : Option.Type.Radio) : undefined,
        'value': isSelected,
      })
    })
  }
}
