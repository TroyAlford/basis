import type { ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react'
import { cloneElement, createElement, isValidElement } from 'react'
import { IconBase } from '../../icons/IconBase/IconBase'
import { Intent as IntentIcon } from '../../icons/Intent'
import { Intent } from '../../types/Intent'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'

import './Dialog.styles.ts'

export type DialogDefaultValue = 'confirm' | false

interface DialogButtonDefinition<T> {
  intent?: Intent,
  label: ReactNode,
  value: T,
}

type DialogButtonElement<T> = ReactElement<{
  'children'?: ReactNode,
  'data-intent'?: Intent,
  'data-value': T,
  'onActivate'?: (event: SyntheticEvent) => void,
  'type'?: unknown,
}>

export type DialogButton<T> = DialogButtonDefinition<T> | DialogButtonElement<T>

/** Payload for {@link Dialog.open} and rows owned by {@link OverlayProvider} (before `id` / refs / `resolve`). */
export interface IDialog<T = DialogDefaultValue> {
  /** Buttons to render. Objects use `value`; JSX button elements use `data-value`. */
  buttons: DialogButton<T>[],
  /** Dialog content. */
  content: ReactNode,
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon: (typeof IconBase) | ReactNode,
  /** Process-unique id for the dialog. */
  id: string,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent: Intent,
  /** Reference to the native `<dialog>` element. */
  nodeRef: RefObject<HTMLDialogElement | null>,
  /** Callback that resolves with the chosen button value or cancel value. */
  onResolve: (value: T) => void,
  /** Dialog title. */
  title: ReactNode,
}

/**
 * Native `<dialog>` host row (mounted by {@link OverlayProvider}) plus static `Dialog.open` /
 * `Dialog.confirm` entry points.
 */
export class Dialog extends Component<IDialog<unknown>, HTMLDialogElement> {
  static displayName = 'Dialog'
  static readonly Intent = Intent

  static confirm({
    content,
    icon,
    intent = Dialog.Intent.Primary,
    labelCancel: cancelLabel = 'Cancel',
    labelConfirm: confirmLabel = 'OK',
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
  static open(
    request?: Partial<Omit<IDialog<DialogDefaultValue>, 'buttons' | 'id' | 'nodeRef' | 'onResolve'>>,
  ): Promise<DialogDefaultValue>
  static open<T>(
    request: Partial<Omit<IDialog<T>, 'id' | 'nodeRef' | 'onResolve'>> & { buttons: DialogButton<T>[] },
  ): Promise<T | false>
  /**
   * @param request - Optional dialog payload. Omit buttons for default Cancel / OK behavior.
   * @returns Promise that resolves with the chosen button value or cancel value.
   */
  static open<T = DialogDefaultValue>(
    request: Partial<Omit<IDialog<T | DialogDefaultValue>, 'id' | 'nodeRef' | 'onResolve'>> = {},
  ): Promise<T | DialogDefaultValue> {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(`
        OverlayProvider is not mounted. Render <OverlayProvider /> inside your React application
        tree before using Dialog.open() or Notification.create().
      `.trim().replace(/\s+/g, ' '))
    }
    return window.overlayProvider.openDialog(request)
  }

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<IDialog<unknown>>, prevState: Readonly<object>): void {
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
    const { onResolve } = this.props
    return {
      ...super.attributes,
      ['data-intent']: this.props.intent ?? Dialog.Intent.Default,
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        onResolve(false)
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
          {buttons.map((button, index) => this.renderButton(button, index, onResolve))}
        </footer>
      </>
    )
  }

  private renderButton(
    button: DialogButton<unknown>,
    index: number,
    onResolve: (value: unknown) => void,
  ): ReactNode {
    if (isValidElement(button)) {
      const props = button.props
      return cloneElement(button, {
        'data-intent': props['data-intent'] ?? Dialog.Intent.Default,
        'key': index,
        'onActivate': (event: SyntheticEvent) => {
          props.onActivate?.(event)
          onResolve(props['data-value'])
        },
        'type': props.type ?? Button.Type.Submit,
      } as Partial<typeof props> & { key: number })
    }

    return (
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
    )
  }
}
