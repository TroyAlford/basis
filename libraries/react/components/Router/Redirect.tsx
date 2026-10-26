import type * as React from 'react'
import { Component } from '../Component/Component'

/** Props for the Redirect component */
interface Props {
  /** The URL to redirect to */
  to: string,
}

/**
 * A component that performs a client-side redirect when mounted
 */
export class Redirect extends Component<Props> {
  static displayName = 'Redirect'

  override componentDidMount(): void {
    const { to } = this.props
    window.history.replaceState({}, '', to)
  }

  override render(): React.ReactNode { return null }
}
