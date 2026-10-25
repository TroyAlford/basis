import { expect, test } from 'bun:test'
import { Editor } from '../Editor/Editor'
import { TextEditor } from '../TextEditor/TextEditor'
import { Dialog } from './Dialog'

interface Card {
  cost: number,
  name: string,
}

class CardEditor extends Editor<Card, HTMLDivElement, { label: string }> {
  get tag(): 'div' {
    return 'div'
  }

  content() {
    return <TextEditor field="name" value={this.current.name} onChange={this.handleField} />
  }
}

class SpecializedCardEditor extends CardEditor {
  static displayName = 'SpecializedCardEditor'
}

class OtherEditor extends Editor<Card, HTMLDivElement> {
  get tag(): 'div' {
    return 'div'
  }
}

class StringEditor extends Editor<string> {
  get tag(): 'div' {
    return 'div'
  }

  content() {
    return <span>{this.current}</span>
  }
}

class BooleanEditor extends Editor<boolean> {
  get tag(): 'div' {
    return 'div'
  }

  content() {
    return <span>{String(this.current)}</span>
  }
}

class NotAnEditor {
  current = { cost: 0, name: '' }
}

test('dialog editor inference and restricted updates compile', async () => {
  const compileOnly = false as boolean

  if (compileOnly) {
    const partial = Dialog.editor(CardEditor, { name: 'Card' })
    const empty = Dialog.editor(CardEditor, {})
    const full = Dialog.editor(CardEditor, { cost: 1, name: 'Card' })
    const inherited = Dialog.editor(SpecializedCardEditor, { name: 'Card' })
    const stringDialog = Dialog.editor(StringEditor, 'text')
    const booleanDialog = Dialog.editor(BooleanEditor, true)
    const configured = Dialog.editor(CardEditor, { name: 'Card' }, {
      props: { label: 'Card' },
      title: 'Edit card',
    })

    const partialResult: Card | false = await partial
    const emptyResult: Card | false = await empty
    const fullResult: Card | false = await full
    const inheritedResult: Card | false = await inherited
    const stringResult: string | false = await stringDialog
    const booleanResult: boolean | false = await booleanDialog

    void partialResult
    void emptyResult
    void fullResult
    void inheritedResult
    void stringResult
    void booleanResult
    void configured

    partial.resolve({ cost: 2, name: 'Card' })
    partial.update({ title: 'Workspace card' })
    partial.update({ props: { readOnly: true } })
    partial.update({ props: { value: { cost: 3, name: 'Card' } } })

    // @ts-expect-error the initial value is inferred from the editor, not the argument
    Dialog.editor(CardEditor, 'not a Card')
    // @ts-expect-error present partial fields must have the full field type
    Dialog.editor(CardEditor, { cost: 'bad' })
    // @ts-expect-error unknown initial-value fields are rejected
    Dialog.editor(CardEditor, { unknown: 1 })
    // @ts-expect-error only Editor subclasses are accepted
    Dialog.editor(NotAnEditor, {})
    // @ts-expect-error construction props cannot supply the initial value
    Dialog.editor(CardEditor, { name: 'Card' }, { props: { value: { cost: 1, name: 'Card' } } })
    // @ts-expect-error resolve requires the full editor value
    partial.resolve({ name: 'Card' })
    // @ts-expect-error content replacement is forbidden on an editor handle
    partial.update({ content: <div /> })
    // @ts-expect-error editor replacement is forbidden on an editor handle
    partial.update({ editor: OtherEditor })
    // @ts-expect-error updated value must be the full editor value
    partial.update({ props: { value: { name: 'Card' } } })
    // @ts-expect-error initialValue is not an updatable editor prop
    partial.update({ props: { initialValue: { cost: 1, name: 'Card' } } })
  }

  expect(true).toBe(true)
})
