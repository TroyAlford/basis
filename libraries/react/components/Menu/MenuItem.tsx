import { match, noop } from '../../../utilities'
import { Keyboard } from '../../types/Keyboard'
import { Component } from '../Component/Component'

/** Props for Menu.Item component. */
interface ItemProps<P = unknown> {
  /** Whether the item is disabled. */
  disabled?: boolean,
  /** Optional id for the item (for example referenced by `aria-activedescendant`). */
  id?: string,
  /** The handler for when the item is activated. */
  onActivate?: (event: React.SyntheticEvent, item: MenuItem<P>) => void,
  /** Callback function called when the item receives focus. */
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void,
  /** ARIA role for the item. Defaults to `menuitem`. */
  role?: string,
  /** Whether the item is selected (meaningful for `role="option"`). */
  selected?: boolean,
  /** Tab index for the item. Defaults to `0` when enabled (use `-1` to keep it out of the Tab sequence). */
  tabIndex?: number,
}

export class MenuItem<P = unknown> extends Component<ItemProps<P> & P> {
  static displayName = 'Menu.Item'
  static defaultProps = {
    ...Component.defaultProps,
    disabled: false,
    onActivate: noop,
  }

  get attributes() {
    const { disabled, id, onFocus, role, selected, tabIndex } = this.props
    return {
      ...super.attributes,
      'aria-disabled': disabled,
      'aria-selected': selected === undefined ? undefined : String(selected),
      'disabled': disabled ? 'disabled' : undefined,
      'id': id,
      'onClick': this.handleActivate,
      'onFocus': onFocus,
      'onKeyDown': this.handleActivate,
      'role': role ?? 'menuitem',
      'tabIndex': disabled ? -1 : (tabIndex ?? 0),
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
