import type { ReactNode, RefObject, SyntheticEvent } from 'react'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { DialogIntent } from './DialogIntent'

const overlayHostRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Notification.create().',
].join(' ')

export interface DialogButton<T> {
  intent?: DialogIntent,
  label: ReactNode,
  value: T,
}

export interface DialogRequest<T = unknown> {
  buttons: DialogButton<T>[],
  cancelValue: T,
  content?: ReactNode,
  title?: ReactNode,
}

interface HostProps {
  dialog: DialogQueued,
  onResolve: (value: unknown) => void,
}

/**
 * Native `<dialog>` host row (mounted by {@link OverlayProvider}) plus static `Dialog.open` /
 * `Dialog.confirm` entry points.
 */
export class Dialog extends Component<HostProps, HTMLDialogElement> {
  static displayName = 'Dialog'

  static readonly Intent = DialogIntent

  static confirm({
    cancelLabel = 'Cancel',
    confirmLabel = 'Confirm',
    content,
    danger = false,
    title,
  }: {
    cancelLabel?: ReactNode,
    confirmLabel?: ReactNode,
    content?: ReactNode,
    danger?: boolean,
    title?: ReactNode,
  }): Promise<boolean> {
    return Dialog.open<boolean>({
      buttons: [
        { intent: Dialog.Intent.Default, label: cancelLabel, value: false },
        {
          intent: danger ? Dialog.Intent.Danger : Dialog.Intent.Primary,
          label: confirmLabel,
          value: true,
        },
      ],
      cancelValue: false,
      content,
      title,
    })
  }

  static open<T>(request: DialogRequest<T>): Promise<T> {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(overlayHostRequiredMessage)
    }
    return window.overlayProvider.openDialog(request)
  }

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<HostProps>, prevState: Readonly<object>): void {
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

/** Dialog row as queued by {@link OverlayProvider} (request fields plus `id`, `nodeRef`, `resolve`). */
export type DialogQueued<T = unknown> = DialogRequest<T> & {
  id: string,
  nodeRef: RefObject<HTMLDialogElement | null>,
  resolve: (value: T) => void,
}
