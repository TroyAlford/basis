import { Component } from 'basis/react'
import * as React from 'react'

export class Application extends Component {
  static displayName = 'Application'
  state = { count: 0 }
  componentDidMount() {
    super.componentDidMount()
    globalThis.__basisHydrated = true
  }
  increment() { this.setState({ count: this.state.count + 1 }) }
  content() {
    return (
      <div>
        <h1>Shell {this.state.count}</h1>
        <button onClick={() => this.increment()}>increment</button>
      </div>
    )
  }
}
