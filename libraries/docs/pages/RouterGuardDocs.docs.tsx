import * as React from 'react'
import { Button, Router, TextEditor } from '@basis/react'

interface State {
  value: string,
}

/** Docs route component with a `dirty` getter so Router can guard navigation via a ref. */
export class RouterGuardDocs extends React.Component<unknown, State> {
  state: State = {
    value: 'clean',
  }

  get dirty(): boolean {
    return this.state.value !== 'clean'
  }

  render(): React.ReactNode {
    return (
      <section>
        <h1>Router Guard Demo</h1>
        <p>
          This page intentionally becomes dirty when edited. Use the left navigation to test
          Router&apos;s unsaved-changes guard.
        </p>
        <p>
          Change the value below, then use the docs navigation to leave this page.
          You should see the unsaved-changes confirmation dialog.
        </p>
        <TextEditor
          initialValue="clean"
          value={this.state.value}
          onChange={value => this.setState({ value })}
        />
        <p>
          Dirty:
          {' '}
          {String(this.dirty)}
        </p>
        <p>
          <Button
            onActivate={() => this.setState({ value: 'clean' })}
          >
            Reset to clean
          </Button>
        </p>
        <p>
          <Router.Link to="/components/router">
            Back to Router docs
          </Router.Link>
        </p>
      </section>
    )
  }
}
