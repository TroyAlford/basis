import type * as React from 'react'
import { NavigateEvent } from '../../events/NavigateEvent'
import { Component } from '../Component/Component'
import { navigate } from './navigate'

import './Link.styles.ts'

/** Props for the Link component */
interface Props {
  /** The content to render inside the link */
  children: React.ReactNode,
  /** The URL to navigate to */
  to: string,
}

/** A component for client-side navigation between routes */
export class Link extends Component<Props> {
  static displayName = 'Link'

  get attributes() {
    return {
      ...super.attributes,
      'data-active': this.isActive,
      'href': this.props.to,
      'onClick': this.handleClick,
    }
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'a' }

  componentDidMount(): void {
    window.addEventListener(NavigateEvent.name, this.#handleUpdate)
    window.addEventListener('popstate', this.#handleUpdate)
  }

  componentWillUnmount(): void {
    window.removeEventListener(NavigateEvent.name, this.#handleUpdate)
    window.removeEventListener('popstate', this.#handleUpdate)
  }

  #handleUpdate = (): void => this.forceUpdate()

  get isActive(): boolean {
    return window.location.pathname === this.props.to
  }

  handleClick: React.MouseEventHandler<HTMLAnchorElement> = event => {
    event.preventDefault()

    if (this.isActive) return // do not navigate if this is already the route

    navigate(this.props.to)
  }

  content(): React.ReactNode {
    return this.props.children
  }
}
