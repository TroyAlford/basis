import * as React from 'react'

/** Props for the Link component */
interface Props {
  /** The content to render inside the link */
  children: React.ReactNode,
  /** The URL to navigate to */
  to: string,
}

/** A component for client-side navigation between routes */
export class Link extends React.Component<Props> {
  handleClick: React.MouseEventHandler<HTMLAnchorElement> = event => {
    event.preventDefault()
    window.history.pushState({}, '', this.props.to)
  }

  render(): React.ReactNode {
    const { children, to } = this.props
    return (
      <a href={to} onClick={this.handleClick}>
        {children}
      </a>
    )
  }
}
