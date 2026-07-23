import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Component, Dialog, Editor, OverlayProvider, TextEditor } from '@basis/react'
import { clone } from '@basis/utilities'

import './fixture.styles.ts'

interface Value {
  name: string,
  slug: string,
}

interface CreateLikeState {
  current: Value,
  slugEdited: boolean,
}

/** Mirrors wiki CreateEditor: autoFocus name, selectOnFocus, custom onChange handlers. */
class CreateLikeEditor extends Editor<Value, HTMLDivElement, object, CreateLikeState> {
  static displayName = 'CreateLikeEditor'

  override get defaultState(): CreateLikeState {
    return {
      ...super.defaultState,
      current: this.props.value ?? this.props.initialValue ?? { name: '', slug: '' },
      slugEdited: false,
    }
  }

  #handleNameChange = (value: string): void => {
    const next = clone(this.current)
    next.name = value
    if (!this.state.slugEdited) next.slug = value.toLowerCase().replace(/\s+/g, '-')
    void this.handleChange(next)
  }

  content(): React.ReactNode {
    const { name, slug } = this.current
    return super.content(
      <>
        <div className="field">
          <label>Name*</label>
          <TextEditor
            autoFocus
            selectOnFocus
            field="name"
            placeholder="Name"
            value={name}
            onChange={this.#handleNameChange}
          />
        </div>
        <div className="field">
          <label>Slug</label>
          <TextEditor
            selectOnFocus
            field="slug"
            placeholder="URL Slug"
            value={slug}
            onChange={value => { void this.handleChange({ ...this.current, slug: value }) }}
          />
        </div>
      </>,
    )
  }
}

interface State {
  lastResult: string,
}

class FixtureApp extends Component<object, HTMLDivElement, State> {
  static displayName = 'FixtureApp'

  state: State = { lastResult: 'idle' }

  #openCreate = async (): Promise<void> => {
    const result = await Dialog.editor(
      CreateLikeEditor,
      { name: '', slug: '' },
      { title: 'New Article...' },
    )
    this.setState({
      lastResult: result === false ? 'cancelled' : `submitted: ${JSON.stringify(result)}`,
    })
  }

  content(): React.ReactNode {
    return (
      <>
        <Button data-testid="open-create" onActivate={() => { void this.#openCreate() }}>
          New Article...
        </Button>
        <output data-testid="result">{this.state.lastResult}</output>
        <OverlayProvider />
      </>
    )
  }
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<FixtureApp />)
}
