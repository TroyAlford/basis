import { Editor } from '../Editor/Editor'
import { TextEditor } from '../TextEditor/TextEditor'

export interface NameSlugValue {
  name: string,
  slug: string,
}

/** Name/slug editor for dialog keyboard tests (mirrors create-document flows). */
export class NameSlugEditor extends Editor<NameSlugValue, HTMLDivElement> {
  static displayName = 'NameSlugEditor'

  content() {
    return super.content(
      <>
        <TextEditor
          autoFocus
          selectOnFocus
          field="name"
          value={this.current.name}
          onChange={this.handleField}
        />
        <TextEditor
          multiline
          field="slug"
          value={this.current.slug}
          onChange={this.handleField}
        />
      </>,
    )
  }

  get tag(): 'div' {
    return 'div'
  }
}
