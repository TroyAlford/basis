import * as React from 'react'
import { sortBy, titleCase } from '@basis/utilities'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import { Focusable } from '../../mixins/Focusable'
import type { Mixin } from '../../types/Mixin'
import { DropdownMenu } from '../DropdownMenu/DropdownMenu'
import { Editor } from '../Editor/Editor'
import type { MenuItem } from '../Menu/MenuItem.tsx'

import './EnumEditor.styles.ts'

/** Type constraint for enum objects */
type EnumType = Record<string, string | number>

/** Props specific to enum editor. */
interface Props<T extends EnumType> extends IAccessible, IFocusable {
  /** Whether to close the dropdown when an option is selected */
  closeOnActivate?: boolean,
  /** The enum object to display options for */
  enum: T,
  /** Whether to open the dropdown */
  open?: boolean,
}

interface EnumOption<T extends EnumType> {
  name: string,
  value: T[keyof T],
}

/**
 * Enum input editor component that extends the Editor base class.
 * Displays enum values in a dropdown with toggleable options.
 */
export class EnumEditor<T extends EnumType> extends Editor<T[keyof T], HTMLDivElement, Props<T>> {
  static displayName = 'EnumEditor'
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Accessible)
      .add(Focusable)
  }

  /** Default props for enum editor. */
  static defaultProps = {
    ...super.defaultProps,
    closeOnActivate: true,
  }

  #options: EnumOption<T>[] | null = null

  /**
   * Gets the available options from the enum prop.
   * Filters out non-alphabetic keys and sorts by value.
   * @returns The available options.
   */
  get options(): EnumOption<T>[] {
    if (!this.#options) {
      const array = Object.entries(this.props.enum)
        .filter(([name]) => name.match(/^[a-z]/i))
        .map(([name, value]) => ({ name: titleCase(name), value: value as T[keyof T] }))
      this.#options = sortBy(array, v => v.value)
    }

    return this.#options
  }

  /**
   * Renders the trigger text for the dropdown.
   * @returns The display text for the current selection
   */
  private renderTrigger = (): string => {
    const selectedOption = this.options.find(option => this.current === option.value)
    return selectedOption?.name || 'None'
  }

  /**
   * Determines if the component should update.
   * @param nextProps The next props
   * @returns Whether the component should update
   */
  shouldComponentUpdate(nextProps: Props<T>): boolean {
    if (this.props.enum !== nextProps.enum) {
      this.#options = null
    }
    return true
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as the selected option name
   */
  override readOnly(): React.ReactNode {
    return (
      <span className="value">
        {this.renderTrigger()}
      </span>
    )
  }

  #handleChange = (_, menuItem: MenuItem<{ data: T[keyof T] }>): void => {
    this.handleChange(menuItem.props.data)
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    return super.content(
      <DropdownMenu
        disabled={this.props.readOnly}
        open={this.props.open}
        trigger={<>{this.renderTrigger()}</>}
      >
        {this.options.map(({ name, value }) => (
          <DropdownMenu.Item
            key={value}
            closeOnActivate={this.props.closeOnActivate}
            data={value}
            onActivate={this.#handleChange}
          >
            {name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu>,
    )
  }
}
