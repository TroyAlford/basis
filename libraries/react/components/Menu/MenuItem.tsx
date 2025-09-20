import { match, noop } from '@basis/utilities'
import { Keyboard } from '../../types/Keyboard'
import { Component } from '../Component/Component'

/** Props for Menu.Item component. */
interface ItemProps<P = unknown> {
  /** Whether the item is disabled. */
  disabled?: boolean,
  /** The handler for when the item is activated. */
  onActivate?: (event: React.SyntheticEvent, item: MenuItem<P>) => void,
}

export class MenuItem<P = unknown> extends Component<ItemProps<P> & P> {
  static displayName = 'Menu.Item'
  static defaultProps = {
    ...Component.defaultProps,
    disabled: false,
    onActivate: noop,
  }

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
  get tag(): keyof React.JSX.IntrinsicElements { return 'li' }

  /**
   * Handles all activation events (click, key).
   * @param event - The synthetic event.
   */
  private handleActivate = (event: React.SyntheticEvent): void => {
    const { disabled, onActivate } = this.props
    if (disabled) return

    match(event.type)
      .when('click').then(() => onActivate(event, this))
      .when('keydown').then(() => {
        const { key } = event as React.KeyboardEvent
        if (![Keyboard.Enter, Keyboard.Space].includes(key as Keyboard)) return
        onActivate(event, this)
      })
  }
}
