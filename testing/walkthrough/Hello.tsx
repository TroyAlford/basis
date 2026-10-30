import { Component } from 'basis/react'

/** Props for the walkthrough greeting. */
interface Props {
  /** Name to greet. */
  name: string,
}

/** The class-based component used by the first-use guide. */
export class Hello extends Component<Props> {
  static displayName = 'Hello'

  content() {
    return <p>Hello, {this.props.name}!</p>
  }
}
