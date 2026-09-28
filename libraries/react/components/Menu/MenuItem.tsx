import { match, noop } from '../../../utilities'
import { Keyboard } from '../../types/Keyboard'
import { Component } from '../Component/Component'

/** Props for Menu.Item component. */
interface ItemProps<P = unknown> {
  /** Whether the item is disabled. */
  disabled?: boolean,
  /** The handler for when the item is activated. */
  onActivate?: (event: React.SyntheticEvent, item: MenuItem<P>) => void,
  /** Whether the item is selected (meaningful for `role="option"`). */
  selected?: boolean,
}

export class MenuItem<P = unknown> extends Component<ItemProps<P> & P> {
  static displayName = 'Menu.Item'
  static defaultProps = {
    ...Component.defaultProps,
    disabled: false,
    onActivate: noop,
  }

  get attributes() {
    const { disabled, selected } = this.props
    const inherited = super.attributes
    const forward = inherited as Record<string, unknown>

    return {
      ...inherited,
      'aria-disabled': disabled,
      'aria-selected': selected === undefined ? undefined : String(selected),
      'disabled': disabled ? 'disabled' : undefined,
      'onClick': this.handleActivate,
      'onKeyDown': this.handleActivate,
      'role': forward.role ?? 'menuitem',
      'tabIndex': disabled ? -1 : (forward.tabIndex ?? 0),
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
