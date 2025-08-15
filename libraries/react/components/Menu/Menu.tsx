import type * as React from 'react'
import { match } from '@basis/utilities/functions/match.ts'
import { Keyboard } from '../../types/Keyboard.ts'
import { Orientation } from '../../types/Orientation'
import { Component } from '../Component/Component'

import './Menu.styles.ts'

/** Props for the Menu component. */
interface Props {
  /** Whether the menu is disabled. */
  disabled?: boolean,
  /** The orientation of the menu. */
  orientation?: Orientation,
  /** Whether the menu is in read-only mode. */
  readOnly?: boolean,
}

/** Props for Menu.Item component. */
interface ItemProps {
  /** Whether the item is disabled. */
  disabled?: boolean,
  /** The handler for when the item is activated. */
  onActivate?: (event: React.SyntheticEvent) => void,
}

/**
 * A base menu component that provides menu structure and keyboard navigation.
 * Use this for inline menus, or combine with DropdownMenu for popup behavior.
 * @example
 * <Menu>
 *   <Menu.Item onActivate={() => console.log('Item 1 clicked')}>Item 1</Menu.Item>
 *   <Menu.Item onActivate={() => console.log('Item 2 clicked')}>Item 2</Menu.Item>
 * </Menu>
 */
export class Menu extends Component<Props> {
  static defaultProps = {
    ...Component.defaultProps,
    disabled: false,
    orientation: Orientation.Vertical,
    readOnly: false,
  }

  get attributes() {
    return {
      ...super.attributes,
      'aria-disabled': this.props.disabled ? 'true' : undefined,
      'data-orientation': this.props.orientation,
      'disabled': this.props.disabled ? 'disabled' : undefined,
      'onKeyDown': this.handleKeyDown,
      'role': 'menu',
    }
  }
  get classNames(): Set<string> { return super.classNames.add('menu') }
  get tag(): keyof React.JSX.IntrinsicElements { return 'ul' }

  protected handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    match([this.props.orientation, event.key])
      .when([Orientation.Vertical, Keyboard.ArrowDown]).then(() => this.navigateToItem('next'))
      .when([Orientation.Vertical, Keyboard.ArrowUp]).then(() => this.navigateToItem('previous'))
      .when([Orientation.Horizontal, Keyboard.ArrowRight]).then(() => this.navigateToItem('next'))
      .when([Orientation.Horizontal, Keyboard.ArrowLeft]).then(() => this.navigateToItem('previous'))
  }

  /**
   * Navigates to the next or previous menu item based on focus state.
   * @param direction - The direction to navigate to
   */
  private navigateToItem = (direction: 'next' | 'previous'): void => {
    const menuItems = Array.from<HTMLDivElement>(this.rootNode.querySelectorAll('.menu-item.component'))
    if (!menuItems.length) return

    const currentIndex = menuItems.findIndex(item => item.matches(':focus, :focus-within'))
    const nextIndex = currentIndex === -1 ? 0 : match(direction)
      .when('next').then(currentIndex === menuItems.length - 1 ? 0 : currentIndex + 1)
      .when('previous').then(currentIndex === 0 ? menuItems.length - 1 : currentIndex - 1)
      .else(currentIndex)

    menuItems[nextIndex]?.focus()
  }

  /** Menu item component that extends Component for proper semantic HTML. */
  static Item = class MenuItem extends Component<ItemProps> {
    get attributes() {
      const { disabled } = this.props
      return {
        ...super.attributes,
        'aria-disabled': disabled,
        'aria-selected': false,
        'disabled': disabled ? 'disabled' : undefined,
        'onClick': this.handleActivate,
        'onKeyDown': this.handleActivate,
        'role': 'menuitem',
        'tabIndex': disabled ? -1 : 0,
      }
    }
    get classNames(): Set<string> { return super.classNames.add('menu-item') }
    get tag(): keyof React.JSX.IntrinsicElements { return 'li' }

    /**
     * Handles all activation events (click, key).
     * @param event - The synthetic event.
     */
    private handleActivate = (event: React.SyntheticEvent): void => {
      const { disabled, onActivate } = this.props
      if (disabled) return

      match(event.type)
        .when('click').then(() => onActivate(event))
        .when('keydown').then(() => {
          const { key } = event as React.KeyboardEvent
          if (![Keyboard.Enter, Keyboard.Space].includes(key as Keyboard)) return
          onActivate(event)
        })
    }
  }

  /** Divider component for visual separation between menu items. */
  static Divider = class MenuDivider extends Component {
    get attributes() {
      return {
        ...super.attributes,
        role: 'separator',
      }
    }
    get classNames(): Set<string> { return super.classNames.add('menu-divider') }
    get tag(): keyof React.JSX.IntrinsicElements { return 'hr' }
  }
}
