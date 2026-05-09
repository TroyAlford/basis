import type { ReactNode, SyntheticEvent } from 'react'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Dialog } from './Dialog'
import type { DialogEntry } from './DialogEntry'

interface Props {
  dialog: DialogEntry,
  onResolve: (value: unknown) => void,
}

/**
 * Renders the active native dialog and opens it after React commits the node.
 */
export class DialogView extends Component<Props, HTMLDialogElement> {
  static displayName = 'DialogView'

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<object>): void {
    super.componentDidUpdate(prevProps, prevState)
    if (prevProps.dialog.id !== this.props.dialog.id) this.#syncModalOpenState()
  }

  #syncModalOpenState(): void {
    const node = this.props.dialog.nodeRef.current
    if (!node) return

    if (!node.open && typeof node.showModal === 'function') {
      node.showModal()
    } else if (!node.open) {
      node.setAttribute('open', '')
    }
  }

  get attributes() {
    const { dialog, onResolve } = this.props
    return {
      ...super.attributes,
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onResolve(dialog.cancelValue)
      },
    }
  }

  get tag() {
    return 'dialog' as const
  }

  content(): ReactNode {
    const { dialog, onResolve } = this.props
    return (
      <form method="dialog">
        <header>
          {dialog.title && <h2>{dialog.title}</h2>}
        </header>
        <section>
          {dialog.content}
        </section>
        <footer>
          {dialog.buttons.map((button, index) => (
            <Button
              key={index}
              data-intent={button.intent ?? Dialog.Intent.Default}
              type={Button.Type.Submit}
              onActivate={() => {
                onResolve(button.value)
              }}
            >
              {button.label}
            </Button>
          ))}
        </footer>
      </form>
    )
  }
}
