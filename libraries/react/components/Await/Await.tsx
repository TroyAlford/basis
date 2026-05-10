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
  #resolveToken = 0

  state: State = {
    loaded: false,
  }

  override componentDidMount(): void {
    void this.#resolveChildren()
  }

  override componentDidUpdate(prevProps: Readonly<Props>): void {
    if (prevProps.children !== this.props.children) {
      void this.#resolveChildren()
    }
  }

  #isThenable(value: unknown): value is Promise<React.ReactNode> {
    return (
      typeof value === 'object'
      && value != null
      && 'then' in value
      && typeof (value as PromiseLike<unknown>).then === 'function'
    )
  }

  async #resolveChildren(): Promise<void> {
    const raw = this.props.children
    const myToken = ++this.#resolveToken

    if (!this.#isThenable(raw)) {
      if (myToken !== this.#resolveToken) return
      this.setState({
        children: raw as React.ReactNode,
        loaded: true,
      })
      return
    }

    if (myToken !== this.#resolveToken) return

    if (this.state.loaded) {
      this.setState({ loaded: false })
    }

    const resolved = await raw
    if (myToken !== this.#resolveToken) return
    this.setState({
      children: resolved,
      loaded: true,
    })
  }

  override render(): React.ReactNode {
    if (!this.state.loaded) return this.props.fallback
    return this.state.children
  }
}
