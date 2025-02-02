import * as React from 'react'

/** Props for the Switch component */
interface Props {
  /** The routes to render. Only the first matching route will be rendered */
  children: React.ReactNode,
}

/**
 * A component that renders only the first matching route from its children
 */
export class Switch extends React.Component<Props> {
  render(): React.ReactNode {
    const child = React.Children.toArray(this.props.children)
      .find(c => React.isValidElement(c))
    return (
      <React.Fragment>
        {child}
      </React.Fragment>
    )
  }
}
