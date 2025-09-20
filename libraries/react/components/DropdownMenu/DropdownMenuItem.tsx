import { MenuItem } from '../Menu/MenuItem'

type ItemProps<P = unknown> = typeof MenuItem<P>['prototype']['props'] & {
  closeOnActivate?: boolean,
}

export class DropdownMenuItem<P = unknown> extends MenuItem<ItemProps<P> & P> {
  static defaultProps = {
    ...MenuItem.defaultProps,
    closeOnActivate: true,
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-close-on-activate': !!this.props.closeOnActivate,
    }
  }
}
