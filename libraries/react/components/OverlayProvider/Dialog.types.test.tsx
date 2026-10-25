import { expect, test } from 'bun:test'
import { Editor } from '../Editor/Editor'
import { TextEditor } from '../TextEditor/TextEditor'
import { Dialog } from './Dialog'

interface Card {
  id: number,
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

class OtherEditor extends Editor<Card, HTMLDivElement> {
  get tag(): 'div' {
    return 'div'
  }
}

test('dialog editor inference and restricted updates compile', async () => {
  const compileOnly = false as boolean

  if (compileOnly) {
    const dialog = Dialog.editor(CardEditor, { id: 1, name: '' }, {
      props: { label: 'Card' },
      title: 'Edit card',
    })

    const value: Card | false = await dialog
    void value

    dialog.update({ title: 'Workspace card' })
    dialog.update({ props: { readOnly: true } })
    dialog.update({ props: { value: { id: 2, name: 'Next' } } })

    // @ts-expect-error an editor handle cannot replace its content
    dialog.update({ content: <div /> })
    // @ts-expect-error an editor handle cannot swap constructors
    dialog.update({ editor: OtherEditor })
    // @ts-expect-error the explicit value must match the editor's value type
    dialog.update({ props: { value: 'not a Card' } })
    // @ts-expect-error the initial value must match the editor's value type
    Dialog.editor(CardEditor, 'not a Card')
    // @ts-expect-error the initial value comes from the constructor, not props
    Dialog.editor(CardEditor, { id: 1, name: '' }, { props: { value: 'not a Card' } })

    const choice = Dialog.choice('Pick one', [['yes', 'Yes'], ['no', 'No']] as const)
    const chosen: 'yes' | 'no' | false = await choice
    void chosen

    const opened = Dialog.open<string>(<span>Loading</span>)
    const openedValue: string | false = await opened
    void openedValue
    opened.update({ content: <span>Loaded</span> })

    const confirmed = Dialog.confirm('Sure?')
    confirmed.update({ title: 'Still sure?' })
    // @ts-expect-error confirm resolves booleans
    confirmed.resolve('yes')
  }

  expect(true).toBe(true)
})
