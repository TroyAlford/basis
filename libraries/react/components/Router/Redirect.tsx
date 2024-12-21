import * as React from 'react'

/** Props for the Redirect component */
interface Props {
  /** The URL to redirect to */
  to: string,
}

/**
 * A component that performs a client-side redirect when mounted
 */
export class Redirect extends React.Component<Props> {
  componentDidMount(): void {
    const { to } = this.props
    window.history.replaceState({}, '', to)
  }

  render(): React.ReactNode { return null }
}
