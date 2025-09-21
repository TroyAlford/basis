import type { IPopup } from '../../mixins/Popup'
import { Popup } from '../../mixins/Popup'
import type { Mixin } from '../../types/Mixin'
import { Component } from '../Component/Component'
import { Menu } from '../Menu/Menu.tsx'

import './PopupMenu.styles.ts'

/** Props for the PopupMenu component. */
type Props = Menu['props'] & IPopup & {
  /** Whether the popup menu is visible. */
  visible?: boolean | 'auto',
}

export class PopupMenu extends Component<Props, HTMLUListElement> {
  static displayName = 'PopupMenu'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Popup)
  }

  get rootNode() {
    return (super.rootNode as unknown as Menu).rootNode
  }
  get tag() { return Menu as Component['tag'] }

  static get defaultProps() {
    return {
      ...super.defaultProps,
      ...Menu.defaultProps,
      arrow: false,
      children: null,
      offset: 0,
      visible: 'auto',
    }
  }

  get attributes() {
    return {
      ...super.attributes,
      'aria-disabled': this.props.disabled ? 'true' : undefined,
      'data-visible': this.props.visible,
      'disabled': this.props.disabled ? 'disabled' : undefined,
      'role': 'menu',
    }
  }
}
