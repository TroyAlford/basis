import * as React from 'react'

/** Props for the Route component */
interface Props<P = object> {
  /** The children to render. Can be a function that receives route params, or a React node */
  children: React.ReactNode | ((params: P) => React.ReactNode),
  /** Whether to match the exact path */
  exact?: boolean,
  /** The URL to redirect to */
  redirectTo?: string,
  /** The template to match */
  template: string,
}

/**
 * A component for matching a route template against the current URL
 * @template P The type of the route parameters
 */
export class Route<P> extends React.Component<Props<P>> { }
