import * as React from 'react'
import { isNil, match, noop } from '@basis/utilities'
import type { IDirectional } from '../../mixins/Directional'
import { Directional } from '../../mixins/Directional'
import { Direction } from '../../types/Direction'
import { Keyboard } from '../../types/Keyboard'
import type { Mixin } from '../../types/Mixin'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Menu } from '../Menu/Menu'

import './DropdownMenu.styles.ts'

interface Props extends IDirectional {
  /**
   * The children to display within the dropdown when it is opened.
   * Generally, these will be a set of DropdownMenu.Item components.
   */
  children?: React.ReactNode,
  /** Whether the dropdown is disabled. */
  disabled?: boolean,
  /** A callback function that is called when the dropdown is closed. */
  onClose?: () => void,
  /** A callback function that is called when the dropdown is opened. */
  onOpen?: () => void,
  /** Whether the dropdown is open. */
  open?: boolean,
  /**
   * The content to display inside the trigger button.
   * This is also shown when the dropdown is closed.
   */
  trigger?: React.ReactNode,
}

interface State {
  /** Whether the dropdown is open. */
  open: boolean,
}

/** A dropdown menu component, composed of a {@link Button} and a {@link Menu}. */
export class DropdownMenu extends Component<Props, HTMLDivElement, State> {
  static Item = Menu.Item
  static Divider = Menu.Divider
  static Direction = Direction

  static displayName = 'DropdownMenu'
  static get mixins(): Set<Mixin> {
    return super.mixins
      .add(Directional)
  }

  static defaultProps = {
    ...super.defaultProps,
    disabled: false,
    onClose: noop,
    onOpen: noop,
    open: undefined,
    trigger: null,
  }

  get attributes() {
    return {
      ...super.attributes,
      'aria-disabled': this.props.disabled ? 'true' : undefined,
      'aria-expanded': this.isOpen,
      'aria-haspopup': 'true',
      'disabled': this.props.disabled ? 'disabled' : undefined,
      'onBlur': this.handleBlur,
      'onKeyDown': this.handleKeyDown,
    }
  }
  get defaultState() {
    return {
      ...super.defaultState,
      open: this.props.open ?? false,
    }
  }
  get menuItems(): HTMLElement[] {
    return Array.from(this.rootNode?.querySelectorAll('.menu-item.component') ?? [])
  }
  get isOpen(): boolean {
    return isNil(this.props.open)
      ? !!this.state.open
      : !!this.props.open
  }
  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }

  private handleBlur = (event: React.FocusEvent<HTMLElement>): void => {
    if (!this.rootNode?.contains(event.relatedTarget as Element) && this.isOpen) {
      this.setState({ open: false }, () => this.props.onClose())
    }
  }

  private handleClose = (): void => {
    this.setState({ open: false }, () => this.props.onClose())
  }

  protected handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented) return
    match(event.key)
      .when(Keyboard.Escape).then(this.handleClose)
  }

  private handleToggle = (): void => {
    if (this.props.disabled) return

    this.setState(prevState => ({ open: !prevState.open }), () => {
      if (this.state.open) {
        this.props.onOpen()
        this.menuItems[0]?.focus()
      } else {
        this.props.onClose()
      }
    })
  }

  content(children?: React.ReactNode): React.ReactNode {
    const { disabled } = this.props

    return (
      <>
        <Button className="trigger" disabled={disabled} onActivate={this.handleToggle}>
          {this.props.trigger}
        </Button>
        {this.isOpen && !disabled && (
          <Menu className="dropdown" disabled={disabled}>
            {children}
          </Menu>
        )}
      </>
    )
  }
}
