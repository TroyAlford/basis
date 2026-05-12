import { Editor, TextEditor } from '@basis/react'

interface Value {
  name: string,
  slug: string,
}

export class DialogEditorExample extends Editor<Value, HTMLDivElement> {
  static displayName = 'DialogEditorExample'

  override get tag() {
    return 'div' as const
  }

  override content() {
    return super.content(
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <strong>Name</strong>
          <TextEditor
            field="name"
            placeholder="Name"
            value={this.current.name}
            onChange={this.handleField}
          />
        </div>
        <div>
          <strong>Slug</strong>
          <TextEditor
            field="slug"
            placeholder="slug"
            value={this.current.slug}
            onChange={this.handleField}
          />
        </div>
      </div>,
    )
  }
}
