import type * as React from 'react'
import { NavigateEvent } from '../../events/NavigateEvent'
import { ensureNavigateRequestListener, hasNavigateHandler, NavigateRequestEvent } from '../../events/NavigateRequestEvent'
import { Component } from '../Component/Component'

import './Link.styles.ts'

/** Props for the Link component */
interface Props {
  /** Force the active state; when omitted, it is derived from the current location. */
  active?: boolean,
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
    if (this.props.active !== undefined) return this.props.active
    return typeof window !== 'undefined'
      ? window.location.pathname === this.props.to
      : false
  }

  handleClick: React.MouseEventHandler<HTMLAnchorElement> = event => {
    if (this.isActive) {
      event.preventDefault() // already the current route; do not add a history entry
      return
    }

    // With no Router (for example a statically built page), let the anchor navigate natively.
    if (!hasNavigateHandler()) return

    event.preventDefault()
    ensureNavigateRequestListener()
    window.dispatchEvent(new NavigateRequestEvent(this.props.to))
  }

  content(): React.ReactNode {
    return this.props.children
  }
}
