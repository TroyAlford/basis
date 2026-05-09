import type { ReactNode, RefObject, SyntheticEvent } from 'react'
import { Warning } from '../../icons'
import { Intent } from '../../types/Intent'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'

import './Dialog.styles.ts'

interface DialogButton<T> {
  intent?: Intent,
  label: ReactNode,
  value: T,
}

/** Payload for {@link Dialog.open} and rows owned by {@link OverlayProvider} (before `id` / refs / `resolve`). */
export interface IDialog<T = unknown> {
  buttons: DialogButton<T>[],
  cancelValue: T,
  content?: ReactNode,
  intent?: Intent,
  title?: ReactNode,
}

interface Props<T = unknown> extends IDialog<T> {
  id: string,
  nodeRef: RefObject<HTMLDialogElement | null>,
  onResolve: (value: unknown) => void,
  resolve: (value: T) => void,
}

/**
 * Native `<dialog>` host row (mounted by {@link OverlayProvider}) plus static `Dialog.open` /
 * `Dialog.confirm` entry points.
 */
export class Dialog extends Component<Props, HTMLDialogElement> {
  static displayName = 'Dialog'

  static readonly Intent = Intent

  static confirm({
    content,
    danger = false,
    labelCancel: cancelLabel = 'Cancel',
    labelConfirm: confirmLabel = 'Confirm',
    title,
  }: {
    content?: ReactNode,
    danger?: boolean,
    labelCancel?: ReactNode,
    labelConfirm?: ReactNode,
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
      intent: danger ? Dialog.Intent.Danger : Dialog.Intent.Primary,
      title,
    })
  }

  /**
   * @param request - Typically `Partial<IDialog<T>>`. Import `type { IDialog }` from this module;
   *   it is not re-exported from `@basis/react`.
   * @returns Promise that resolves with the chosen button value or cancel value.
   */
  static open<T = unknown>(request: Partial<IDialog<T>>): Promise<T> {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(`
        OverlayProvider is not mounted. Render <OverlayProvider /> inside your React application
        tree before using Dialog.open() or Notification.create().
      `.trim().replace(/\s+/g, ' '))
    }
    return window.overlayProvider.openDialog<T>(request)
  }

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<object>): void {
    super.componentDidUpdate(prevProps, prevState)
    if (prevProps.id !== this.props.id) this.#syncModalOpenState()
  }

  #syncModalOpenState(): void {
    const node = this.props.nodeRef.current
    if (!node) return

    if (!node.open && typeof node.showModal === 'function') {
      node.showModal()
    } else if (!node.open) {
      node.setAttribute('open', '')
    }
  }

  get attributes() {
    const { cancelValue, onResolve } = this.props
    return {
      ...super.attributes,
      ['data-intent']: this.props.intent ?? Dialog.Intent.Default,
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onResolve(cancelValue)
      },
    }
  }

  get tag() {
    return 'dialog' as const
  }

  content(): ReactNode {
    const { buttons, content, intent, onResolve, title } = this.props
    const resolvedIntent = intent ?? Dialog.Intent.Default
    const showHeader = Boolean(title)
      || resolvedIntent === Dialog.Intent.Danger
      || resolvedIntent === Dialog.Intent.Primary

    return (
      <>
        {showHeader && (
          <header data-intent={resolvedIntent}>
            {resolvedIntent === Dialog.Intent.Danger && (
              <Warning filled title="Warning" />
            )}
            {title}
          </header>
        )}
        <section>
          {content}
        </section>
        <footer>
          {buttons.map((button, index) => (
            <Button
              key={index}
              type={Button.Type.Submit}
              onActivate={() => {
                onResolve(button.value)
              }}
            >
              {button.label}
            </Button>
          ))}
        </footer>
      </>
    )
  }
}
