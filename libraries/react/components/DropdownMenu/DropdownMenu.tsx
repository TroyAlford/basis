import * as React from 'react'
import { isNil, match, noop } from '@basis/utilities'
import type { IPopup } from '../../mixins/Popup'
import { AnchorPoint } from '../../types/AnchorPoint'
import { Keyboard } from '../../types/Keyboard'
import { Event, events } from '../../utilities/EventManager.ts'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Menu } from '../Menu/Menu'
import { PopupMenu } from '../PopupMenu/PopupMenu'
import { DropdownMenuItem } from './DropdownMenuItem.tsx'

import './DropdownMenu.styles.ts'

interface Props extends IPopup {
  /**
   * The children to display within the dropdown when it is opened.
   * Generally, these will be a set of DropdownMenu.Item components.
   */
  children?: React.ReactNode,
  /** Whether the dropdown should close when menu items are activated. */
  closeOnActivate?: boolean,
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
  static AnchorPoint = AnchorPoint
  static Item = DropdownMenuItem
  static Divider = Menu.Divider

  static displayName = 'DropdownMenu'
  static defaultProps = {
    ...super.defaultProps,
    anchorPoint: AnchorPoint.BottomStart,
    closeOnActivate: true,
    disabled: false,
    onClose: noop,
    onOpen: noop,
    open: undefined,
    trigger: null,
  }

  private button = React.createRef<HTMLButtonElement>()
  private unsubscribeBlur?: () => void

  get attributes() {
    return {
      ...super.attributes,
      'aria-disabled': this.props.disabled ? 'true' : undefined,
      'aria-expanded': this.isOpen,
      'aria-haspopup': 'true',
      'disabled': this.props.disabled ? 'disabled' : undefined,
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

  componentDidMount(): void {
    this.unsubscribeBlur = events.on(Event.Blur, this.rootNode, this.handleBlur)
  }

  componentWillUnmount(): void {
    this.unsubscribeBlur?.()
  }

  private handleBlur = (): void => {
    if (this.isOpen) {
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

    const clones = React.Children.map(children, child => {
      if (React.isValidElement(child) && child.type === DropdownMenuItem) {
        const { closeOnActivate = true, onActivate = noop } = child.props as DropdownMenuItem['props']

        return React.cloneElement<DropdownMenuItem<typeof child.props>['props']>(child, {
          onActivate: (event: React.MouseEvent, menuItem) => {
            onActivate(event, menuItem)
            if (closeOnActivate) this.handleClose()
          },
        })
      }

      return child
    })

    return (
      <>
        <Button
          className="trigger"
          disabled={disabled}
          nodeRef={this.button}
          onActivate={this.handleToggle}
        >
          {this.props.trigger}
        </Button>
        {this.isOpen && !disabled && (
          <PopupMenu
            anchorPoint={this.props.anchorPoint}
            anchorTo={this.button}
            arrow={this.props.arrow}
            disabled={disabled}
            offset={this.props.offset}
          >
            {clones}
          </PopupMenu>
        )}
      </>
    )
  }
}
