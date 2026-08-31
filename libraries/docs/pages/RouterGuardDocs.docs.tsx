import { Button, Component, Router, TextEditor } from '@basis/react'

interface State {
  value: string,
}

/** Docs route component with a `dirty` getter so Router can guard navigation via a ref. */
export class RouterGuardDocs extends Component<unknown, HTMLDivElement, State> {
  static displayName = 'RouterGuardDocs'

  get defaultState(): State {
    return { value: 'clean' }
  }

  get dirty(): boolean {
    return this.state.value !== 'clean'
  }

  content() {
    return (
      <>
        <h1>Router Guard Demo</h1>
        <p>
          Change the value, then use the docs navigation to leave this page.
          Router should show an unsaved-changes confirmation dialog.
          Internal navigation and Back/Forward use that dialog when an overlay provider exists;
          reload or closing the tab uses the browser&apos;s native <code>beforeunload</code> prompt
          instead. <code>onBeforeNavigate</code> on a route component overrides the default dirty
          behavior when it runs first.
        </p>
        <TextEditor
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
      </>
    )
  }
}
