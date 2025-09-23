import type * as React from 'react'
import { match } from '@basis/utilities'
import { Keyboard } from '../../types/Keyboard'
import { Orientation } from '../../types/Orientation'
import { Component } from '../Component/Component'
import { MenuItem } from './MenuItem'

import './Menu.styles.ts'

/** Props for the Menu component. */
interface Props {
  /** Whether the menu is disabled. */
  disabled?: boolean,
  /** Callback function called when a key is pressed while the menu has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void,
  /** The orientation of the menu. */
  orientation?: Orientation,
  /** Whether the menu is in read-only mode. */
  readOnly?: boolean,
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
export class Menu extends Component<Props, HTMLUListElement> {
  static Orientation = Orientation

  static displayName = 'Menu'
  static get defaultProps() {
    return {
      ...Component.defaultProps,
      disabled: false,
      orientation: Orientation.Vertical,
      readOnly: false,
    }
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
  get tag(): keyof React.JSX.IntrinsicElements { return 'ul' }

  protected handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    match([this.props.orientation, event.key])
      .when([Orientation.Vertical, Keyboard.ArrowDown]).then(() => {
        event.preventDefault()
        this.navigateToItem('next')
      })
      .when([Orientation.Vertical, Keyboard.ArrowUp]).then(() => {
        event.preventDefault()
        this.navigateToItem('previous')
      })
      .when([Orientation.Horizontal, Keyboard.ArrowRight]).then(() => {
        event.preventDefault()
        this.navigateToItem('next')
      })
      .when([Orientation.Horizontal, Keyboard.ArrowLeft]).then(() => {
        event.preventDefault()
        this.navigateToItem('previous')
      })
      .else(() => {
        this.props.onKeyDown?.(event)
      })
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
  static Item = MenuItem

  /** Divider component for visual separation between menu items. */
  static Divider = class MenuDivider extends Component {
    static displayName = 'Menu.Divider'
    get attributes() {
      return {
        ...super.attributes,
        role: 'separator',
      }
    }
    get tag(): keyof React.JSX.IntrinsicElements { return 'hr' }
  }
}
