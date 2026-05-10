import type { ReactNode, RefObject, SyntheticEvent } from 'react'
import { createElement } from 'react'
import { IconBase } from '../../icons/IconBase/IconBase'
import { Intent as IntentIcon } from '../../icons/Intent'
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
  icon?: (typeof IconBase) | ReactNode,
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
    icon,
    intent = Dialog.Intent.Primary,
    labelCancel: cancelLabel = 'Cancel',
    labelConfirm: confirmLabel = 'Confirm',
    title,
  }: {
    content?: ReactNode,
    icon?: (typeof IconBase) | ReactNode,
    intent?: Intent,
    labelCancel?: ReactNode,
    labelConfirm?: ReactNode,
    title?: ReactNode,
  }): Promise<boolean> {
    const confirmIntent = intent === Dialog.Intent.Danger || intent === Dialog.Intent.Success
      ? intent
      : Dialog.Intent.Primary

    return Dialog.open<boolean>({
      buttons: [
        { intent: Dialog.Intent.Default, label: cancelLabel, value: false },
        {
          intent: confirmIntent,
          label: confirmLabel,
          value: true,
        },
      ],
      cancelValue: false,
      content,
      icon,
      intent,
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

  get icon(): ReactNode {
    const intent = this.props.intent ?? Dialog.Intent.Default
    if (this.props.icon) {
      return (this.props.icon?.constructor?.name === IconBase.name)
        // @ts-expect-error - TS doesn't like the SVGProps definitions
        ? createElement(this.props.icon, {})
        : this.props.icon as ReactNode
    }
    return <IntentIcon is={intent} />
  }

  content(): ReactNode {
    const { buttons, content, onResolve, title } = this.props

    return (
      <>
        <header>
          {this.icon}
          {title}
        </header>
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
