import * as React from 'react'

/** Props for the Link component */
export interface LinkProps {
  /** The content to render inside the link */
  children: React.ReactNode,
  /** The URL to navigate to */
  to: string,
}

/**
 * A component for client-side navigation between routes
 */
export class Link extends React.Component<LinkProps> {
  /**
   * Handles the click event
   * @param event - The mouse event
   */
  handleClick = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    event.preventDefault()
    window.history.pushState({}, '', this.props.to)
  }

  render() {
    const { children, to } = this.props
    return (
      <a href={to} onClick={this.handleClick}>
        {children}
      </a>
    )
  }
}
