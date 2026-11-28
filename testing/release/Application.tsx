import { Component, readBasisRuntime } from 'basis/react'
import * as React from 'react'

export class Application extends Component {
  static displayName = 'Application'
  componentDidMount() {
    super.componentDidMount()
    globalThis.__releaseHydrated = true
  }
  content() {
    return <h1 data-testid="release-version">{readBasisRuntime().version}</h1>
  }
}
