import * as React from 'react'

/** Props for the Redirect component */
export interface RedirectProps {
  /** The URL to redirect to */
  to: string,
}

/**
 * A component that performs a client-side redirect when mounted
 */
export class Redirect extends React.Component<RedirectProps> {
  componentDidMount(): void {
    const { to } = this.props
    window.history.replaceState({}, '', to)
  }

  render() {
    return null
  }
}
