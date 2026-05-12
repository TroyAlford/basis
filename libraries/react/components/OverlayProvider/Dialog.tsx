import type { ComponentClass, ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react'
import { cloneElement, createElement, isValidElement } from 'react'
import { IconBase } from '../../icons/IconBase/IconBase'
import { Intent as IntentIcon } from '../../icons/Intent'
import { Intent } from '../../types/Intent'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Editor } from '../Editor/Editor'
import { REQUIRED_MESSAGE } from './REQUIRED_MESSAGE.ts'

import './Dialog.styles.ts'

type DialogEditorProps<Value, Props extends object> =
  Props
  & {
    onChange?: Editor<Value>['props']['onChange'],
    value?: never,
  }

/** Options for {@link Dialog.editor}. */
export interface DialogEditorOptions<Value, Props extends object = object> {
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon?: (typeof IconBase) | ReactNode,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent?: Intent,
  /**
   * Props for the editor instance. `onChange` is wrapped so the dialog can record the latest
   * value for confirm. Pass the initial value as the second {@link Dialog.editor} argument.
   */
  props?: DialogEditorProps<Value, Props>,
  /** Dialog title. */
  title?: ReactNode,
}

type DialogButtonDefinition<T> =
  | { intent?: Intent, label: ReactNode, resolve: () => T, value?: never }
  | { intent?: Intent, label: ReactNode, value: T }

type DialogButtonElement<T> = ReactElement<{
  'children'?: ReactNode,
  'data-intent'?: Intent,
  'data-value': T,
  'onActivate'?: (event: SyntheticEvent) => void,
  'type'?: unknown,
}>

export type DialogButton<T> = DialogButtonDefinition<T> | DialogButtonElement<T>

/** Payload for {@link Dialog.open}. Mounted-only fields are added by {@link OverlayProvider}. */
export interface IDialog<T = boolean> {
  /** Buttons to render. Objects use `value` or `resolve`; JSX button elements use `data-value`. */
  buttons: DialogButton<T>[],
  /** Dialog content. */
  content: ReactNode,
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon: (typeof IconBase) | ReactNode,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent: Intent,
  /** Dialog title. */
  title: ReactNode,
}

interface Props<T = unknown> extends IDialog<T> {
  /** Process-unique id for the dialog. */
  id: string,
  /** Reference to the native `<dialog>` element. */
  nodeRef: RefObject<HTMLDialogElement | null>,
  /** Callback that resolves with the chosen button value or cancel sentinel. */
  onResolve: (value: T | false) => void,
}

/**
 * Native `<dialog>` host row (mounted by {@link OverlayProvider}) plus static `Dialog.open` /
 * `Dialog.confirm` entry points.
 */
export class Dialog extends Component<Props<unknown>, HTMLDialogElement> {
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
    return Dialog.open<boolean>({
      buttons: [
        {
          intent: intent ?? Dialog.Intent.Primary,
          label: confirmLabel,
          value: true,
        },
        { intent: Dialog.Intent.Default, label: cancelLabel, value: false },
      ],
      content,
      icon,
      intent,
      title,
    })
  }

  /**
   * @param request - Typically `Partial<IDialog<T>>` (import `type { IDialog }` from this module;
   *   it is not re-exported from `@basis/react`). Omit `buttons` for default Cancel / OK (`boolean`).
   * @returns Promise that resolves with the chosen button value or `false` (cancel / dismiss).
   */
  static open<T = boolean>(request: Partial<IDialog<T>> = {}): Promise<T | false> {
    if (typeof window === 'undefined' || !window.overlayProvider) throw new Error(REQUIRED_MESSAGE)
    return window.overlayProvider.openDialog(request)
  }

  /**
   * Opens a dialog whose body is an {@link Editor} subclass. Subscribes to `onChange` and resolves
   * confirm with the latest value (starting from `initialValue`).
   * @param EditorComponent - Editor subclass (validated with {@link Editor.isEditor}).
   * @param initialValue - Starting editor value; typed from the editor's current value.
   * @param options - Title, labels, intent, optional extra content, and editor props.
   * @returns Promise of the recorded value on confirm, or false when cancelled or dismissed.
   */
  static editor<
    Value,
    EditorComponent extends new (
      ...args: never[]
    ) => { current: Value },
    Props extends object = object,
  >(
    EditorComponent: EditorComponent,
    initialValue: Value,
    options: DialogEditorOptions<Value, Props> = {},
  ): Promise<Value | false> {
    if (typeof window === 'undefined' || !window.overlayProvider) throw new Error(REQUIRED_MESSAGE)
    if (!Editor.isEditor(EditorComponent)) {
      throw new Error('Dialog.editor: expected an Editor subclass constructor')
    }

    const {
      icon,
      intent = Dialog.Intent.Primary,
      props: editorProps = {} as DialogEditorProps<Value, Props>,
      title,
    } = options

    const { onChange } = editorProps

    let value = initialValue
    const confirmToken: { readonly __dialogConfirm: true } = { __dialogConfirm: true }

    const content = (
      <>
        {createElement(EditorComponent as unknown as ComponentClass<Record<string, unknown>>, {
          ...editorProps,
          initialValue,
          onChange: (next, field, editor) => {
            value = next
            onChange?.(next, field, editor)
          },
        })}
      </>
    )

    return Dialog.open<Value | false | typeof confirmToken>({
      buttons: [
        <Button key="ok" data-intent={intent ?? Dialog.Intent.Primary} data-value={confirmToken}>OK</Button>,
        <Button key="cancel" data-intent={Dialog.Intent.Default} data-value={false}>Cancel</Button>,
      ],
      content,
      icon,
      intent,
      title,
    }).then(result => (result === confirmToken ? value : result as Value | false))
  }

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<Props<unknown>>, prevState: Readonly<object>): void {
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
      'data-intent': this.props.intent ?? Dialog.Intent.Default,
      'onCancel': (event: SyntheticEvent<HTMLDialogElement>) => {
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
          if ('resolve' in button && typeof button.resolve === 'function') {
            onResolve(button.resolve())
          } else {
            onResolve((button as { value: unknown }).value)
          }
        }}
      >
        {button.label}
      </Button>
    )
  }
}
