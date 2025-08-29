import * as React from 'react'

interface Props {
  children: React.ReactNode | Promise<React.ReactNode>,
  fallback: React.ReactNode,
}
interface State {
  children?: React.ReactNode,
  loaded: boolean,
}

export class Await extends React.Component<Props, State> {
  state: State = {
    loaded: false,
  }

  async componentDidMount(): Promise<void> {
    const children = await this.props.children
    this.setState({ children, loaded: true })
  }

  render(): React.ReactNode {
    if (!this.state.loaded) return this.props.fallback
    return this.state.children
  }
}
