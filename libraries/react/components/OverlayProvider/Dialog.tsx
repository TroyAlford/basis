import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react'
import { cloneElement, createElement, isValidElement } from 'react'
import { classNames, deepEquals } from '../../../utilities'
import { IconBase } from '../../icons/IconBase/IconBase'
import { Intent as IntentIcon } from '../../icons/Intent'
import { Intent } from '../../types/Intent'
import { Keyboard } from '../../types/Keyboard'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Editor } from '../Editor/Editor'
import { dialogDefaultButtonIndex } from './DialogKeyboard.ts'
import type { OverlayLifecycle } from './OverlayLifecycle'
import { REQUIRED_MESSAGE } from './REQUIRED_MESSAGE.ts'

import './Dialog.styles.ts'

/** Class name shape accepted by Basis components. */
export type OverlayClassName = string | Set<string> | Record<string, boolean | (() => boolean)>

type DialogButtonDefinition<T> =
  | { action?: never, intent?: Intent, label: ReactNode, resolve: () => T, value?: never }
  | { action?: never, intent?: Intent, label: ReactNode, resolve?: never, value: T | false }
  | { action: () => void | Promise<void>, intent?: Intent, label: ReactNode, resolve?: never, value?: never }

type DialogButtonElement<T> = ReactElement<{
  'children'?: ReactNode,
  'data-intent'?: Intent,
  'data-value': T | false,
  'disabled'?: boolean,
  'onActivate'?: (event: SyntheticEvent) => void,
  'type'?: unknown,
}>

/** A dialog footer action: a resolving value, a resolving callback, JSX, or a persistent action. */
export type DialogButton<T> = DialogButtonDefinition<T> | DialogButtonElement<T>

/** Options accepted by {@link Dialog.open}. */
export interface DialogOptions<T = boolean> extends OverlayLifecycle<T> {
  /** Footer buttons. Omit or pass an empty array for the historical Cancel / OK default. */
  buttons?: DialogButton<T>[],
  /** Shell class name. Basis always owns the header, body, and footer chrome. */
  className?: OverlayClassName,
  /** Dialog body. */
  content?: ReactNode,
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon?: (typeof IconBase) | ReactNode,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent?: Intent,
  /** Shell style. */
  style?: CSSProperties,
  /** Dialog title. */
  title?: ReactNode,
}

/** Backwards-compatible public name for {@link Dialog.open} request options. */
export type IDialog<T = boolean> = DialogOptions<T>

/** Public handle returned by every dialog helper. */
export interface DialogHandle<T> extends Promise<T | false> {
  /** Abandon the dialog through the shared dismissal guard. */
  dismiss(): Promise<boolean>,
  /** Stable identity for the mounted dialog row. */
  readonly id: string,
  /** Complete the dialog with a value through the shared resolution guard. */
  resolve(value: T): Promise<boolean>,
  /** Patch the same mounted dialog; omitted fields are retained. */
  update(options: Partial<DialogOptions<T>>): void,
}

/** Editor props accepted when opening an editor dialog (the value comes positionally). */
export type DialogEditorInitialProps<Props extends object = object> =
  Partial<Omit<Props, 'initialValue' | 'value'>>

/** Editor props accepted by a handle update, including a deliberate `value` patch. */
export type DialogEditorUpdateProps<Props extends object = object> =
  Partial<Omit<Props, 'initialValue'>>

/** Options accepted by {@link Dialog.editor}. */
export interface DialogEditorOptions<Value, Props extends object = object> extends OverlayLifecycle<Value> {
  /** Shell class name. */
  className?: OverlayClassName,
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon?: (typeof IconBase) | ReactNode,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent?: Intent,
  /** Initial editor props. The value comes from the positional `initialValue` argument. */
  props?: DialogEditorInitialProps<Props>,
  /** Shell style. */
  style?: CSSProperties,
  /** Dialog title. */
  title?: ReactNode,
}

/** Update options for an editor dialog handle; editor replacement is not permitted. */
export interface DialogEditorUpdate<Value, Props extends object = object>
  extends Partial<Omit<DialogEditorOptions<Value, Props>, 'props'>> {
  /** Partial editor prop patch. `value` deliberately replaces the working value. */
  props?: DialogEditorUpdateProps<Props>,
}

/** Public handle returned by {@link Dialog.editor}. */
export interface DialogEditorHandle<Value, Props extends object = object> extends Promise<Value | false> {
  /** Abandon the dialog through the editor's dirty guard and the shared dismissal guard. */
  dismiss(): Promise<boolean>,
  /** Stable identity for the mounted dialog row. */
  readonly id: string,
  /** Complete the dialog with an explicit typed value. */
  resolve(value: Value): Promise<boolean>,
  /** Patch editor shell options or typed editor props without replacing the editor. */
  update(options: DialogEditorUpdate<Value, Props>): void,
}

type EditorInstance<Constructor> =
  Constructor extends new (...args: never[]) => infer Instance ? Instance : never

/** The value type carried by an `Editor<T>` subclass constructor. */
export type EditorValueOf<Constructor> =
  EditorInstance<Constructor> extends { current: infer Value } ? Value : never

/** The props declared by an `Editor<T>` subclass constructor. */
export type EditorPropsOf<Constructor> =
  EditorInstance<Constructor> extends { props: infer Props }
    ? Props extends object ? Props : object
    : object

/** A runtime-only view of the editor state shared by {@link Dialog.editor} and the provider. */
export class DialogEditorState<Value = unknown> {
  readonly Component: new (...args: never[]) => { current: Value }

  baseline: Value

  value: Value

  props: Record<string, unknown>

  constructor(
    EditorComponent: new (...args: never[]) => { current: Value },
    initialValue: Value,
    props: Record<string, unknown>,
  ) {
    this.Component = EditorComponent
    this.baseline = initialValue
    this.value = initialValue
    this.props = props
  }

  /**
   * Whether the working value differs from the editor's original baseline.
   * @returns Whether the editor has unsaved changes.
   */
  get dirty(): boolean {
    return !deepEquals(this.value, this.baseline)
  }

  /**
   * Patch typed editor props. An explicit `value` deliberately replaces the working value.
   * @param patch - Editor props to merge; omitted props are retained.
   */
  updateProps(patch: Record<string, unknown>): void {
    const { value, ...rest } = patch
    this.props = { ...this.props, ...rest }
    if (Object.hasOwn(patch, 'value')) this.value = value as Value
  }
}

/** Fully normalized request handed from a dialog helper to {@link OverlayProvider}. */
export interface DialogRequest<T = unknown> extends DialogOptions<T> {
  buttons: DialogButton<T>[],
  content: ReactNode,
  editor?: DialogEditorState<T>,
}

/** Options for the object form of {@link Dialog.confirm}. */
export interface DialogConfirmOptions extends OverlayLifecycle<boolean> {
  /** Shell class name. */
  className?: OverlayClassName,
  /** Confirmation body. */
  content?: ReactNode,
  /** Dialog header icon. Defaults from `intent` when omitted. */
  icon?: (typeof IconBase) | ReactNode,
  /** Dialog shell intent. Defaults to {@link Intent.Primary}. */
  intent?: Intent,
  /** Cancel / negative label. */
  labelCancel?: ReactNode,
  /** Confirm / affirmative label. */
  labelConfirm?: ReactNode,
  /** Shell style. */
  style?: CSSProperties,
  /** Dialog title. */
  title?: ReactNode,
}

interface Props<T = unknown> extends DialogOptions<T> {
  /** Whether this dialog currently receives keyboard and backdrop interactions. */
  active: boolean,
  /** Whether a persistent action is in flight. */
  busy: boolean,
  /** Normalized footer buttons. */
  buttons: DialogButton<T>[],
  /** Normalized body. */
  content: ReactNode,
  /** Stable row id. */
  id: string,
  /** Native dialog node reference. */
  nodeRef: RefObject<HTMLDialogElement | null>,
  /** Called when a footer button is activated. */
  onActivateButton: (button: DialogButton<T>, index: number) => void,
  /** Called when Escape, native cancel, or a backdrop click requests dismissal. */
  onRequestDismiss: () => void,
}

/**
 * Whether a request value is a dialog options object rather than JSX/content shorthand.
 * React elements, arrays, strings, numbers, and other primitives are content.
 * @param value - Candidate request.
 * @returns True for a plain options object.
 */
function isDialogOptions(value: unknown): value is Partial<DialogOptions<unknown>> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !isValidElement(value)
}

/**
 * Default Cancel / OK buttons for the options-object form of {@link Dialog.open}.
 * @returns New button definitions.
 */
function defaultButtons<T>(): DialogButton<T>[] {
  return [
    { intent: Intent.Default, label: 'Cancel', value: false },
    { intent: Intent.Primary, label: 'OK', value: true },
  ] as DialogButton<T>[]
}

/**
 * Native `<dialog>` host row (mounted by {@link OverlayProvider}) plus static `Dialog.open`,
 * `Dialog.confirm`, `Dialog.choice`, and `Dialog.editor` entry points.
 */
export class Dialog extends Component<Props<unknown>, HTMLDialogElement> {
  static displayName = 'Dialog'

  /** `title`/`content` are Dialog semantics, not native root attributes. */
  static ownedNativeProps = ['content', 'title']
  static readonly Intent = Intent

  /**
   * Open a dialog. Pass an options object for the historical Cancel / OK defaults, or raw
   * JSX/content shorthand for a handle-only dialog with no implicit footer.
   * @param request - Options object, or JSX/content shorthand.
   * @returns An awaitable, updateable handle.
   */
  static open(): DialogHandle<boolean>
  static open<T = boolean>(request: ReactNode | Partial<DialogOptions<T>>): DialogHandle<T>
  static open<T = boolean>(request?: ReactNode | Partial<DialogOptions<T>>): DialogHandle<T> {
    const provider = Dialog.provider()

    if (request === undefined) {
      return provider.openDialog<T>({ buttons: defaultButtons<T>(), content: null })
    }

    if (isDialogOptions(request)) {
      const buttons = Array.isArray(request.buttons) && request.buttons.length > 0
        ? request.buttons as DialogButton<T>[]
        : defaultButtons<T>()

      return provider.openDialog<T>({
        ...request,
        buttons,
        content: request.content ?? null,
      })
    }

    return provider.openDialog<T>({
      buttons: [],
      content: request as ReactNode,
    })
  }

  /**
   * Ask a question with optional labels. The string form is a two-choice specialization
   * (Yes / No); the object form preserves the historical Cancel / OK semantics.
   * @param request - Question content, or confirmation options.
   * @returns An awaitable, updateable boolean handle.
   */
  static confirm(question: ReactNode): DialogHandle<boolean>
  static confirm(options?: DialogConfirmOptions): DialogHandle<boolean>
  static confirm(request?: ReactNode | DialogConfirmOptions): DialogHandle<boolean> {
    if (request === undefined || isDialogOptions(request)) {
      const {
        className,
        content,
        icon,
        intent = Dialog.Intent.Primary,
        labelCancel: cancelLabel = 'Cancel',
        labelConfirm: confirmLabel = 'OK',
        onDismissed,
        onDismissing,
        onError,
        onResolved,
        onResolving,
        style,
        title,
      } = (request ?? {}) as DialogConfirmOptions

      return Dialog.open<boolean>({
        buttons: [
          { intent, label: confirmLabel, value: true },
          { intent: Dialog.Intent.Default, label: cancelLabel, value: false },
        ],
        className,
        content,
        icon,
        intent,
        onDismissed,
        onDismissing,
        onError,
        onResolved,
        onResolving,
        style,
        title,
      })
    }

    return Dialog.open<boolean>({
      buttons: [
        { intent: Dialog.Intent.Primary, label: 'Yes', resolve: () => true },
        { intent: Dialog.Intent.Default, label: 'No', resolve: () => false },
      ],
      content: request as ReactNode,
    })
  }

  /**
   * Render one resolving button per `[value, label]` pair, in input order.
   * @param question - Dialog content.
   * @param choices - Ordered value / label tuples.
   * @returns An awaitable, updateable handle whose result is the selected value or `false`.
   */
  static choice<const Choices extends readonly (
    readonly [unknown, ReactNode])[]>(
    question: ReactNode,
    choices: Choices,
  ): DialogHandle<Choices[number][0]> {
    if (choices.length === 0) {
      throw new Error('Dialog.choice: at least one choice is required.')
    }

    type Value = Choices[number][0]
    const buttons = choices.map(([value, label]) => ({
      label,
      resolve: () => value,
    })) as DialogButton<Value>[]

    return Dialog.open<Value>({ buttons, content: question })
  }

  /**
   * Open a dialog whose body is an {@link Editor} subclass. `T` is inferred from the editor
   * constructor, never from `initialValue`. The editor's dirty state is guarded by default.
   * @param EditorComponent - Editor subclass (validated with {@link Editor.isEditor}).
   * @param initialValue - Starting editor value and dirty baseline.
   * @param options - Shell options and initial typed editor props.
   * @returns An awaitable editor handle with restricted updates.
   */
  static editor<Constructor extends new (
    ...args: never[]) => object>(
    EditorComponent: Constructor,
    initialValue: NoInfer<EditorValueOf<Constructor>>,
    options: DialogEditorOptions<EditorValueOf<Constructor>, EditorPropsOf<Constructor>> = {},
  ): DialogEditorHandle<EditorValueOf<Constructor>, EditorPropsOf<Constructor>> {
    const provider = Dialog.provider()

    if (!Editor.isEditor(EditorComponent)) {
      throw new Error('Dialog.editor: expected an Editor subclass constructor')
    }

    type Value = EditorValueOf<Constructor>
    type EditorProperties = EditorPropsOf<Constructor>

    const {
      className,
      icon,
      intent = Dialog.Intent.Primary,
      onDismissed,
      onDismissing,
      onError,
      onResolved,
      onResolving,
      props: initialProps = {} as DialogEditorInitialProps<EditorProperties>,
      style,
      title,
    } = options

    const editor = new DialogEditorState<Value>(
      EditorComponent as unknown as new (...args: never[]) => { current: Value },
      initialValue as Value,
      initialProps as Record<string, unknown>,
    )

    const handle = provider.openDialog<Value>({
      buttons: [
        { intent, label: 'OK', resolve: () => editor.value },
        { intent: Dialog.Intent.Default, label: 'Cancel', value: false as Value },
      ],
      className,
      content: null,
      editor,
      icon,
      intent,
      onDismissed,
      onDismissing,
      onError,
      onResolved,
      onResolving,
      style,
      title,
    })

    return handle as unknown as DialogEditorHandle<Value, EditorProperties>
  }

  #escapeCloseHandled = false

  #unmounted = false

  #dialogNode: HTMLDialogElement | null = null

  #escapeKeydownListenerNode: HTMLDialogElement | null = null

  #cancelListenerNode: HTMLDialogElement | null = null

  #clickListenerNode: HTMLDialogElement | null = null

  /**
   * Resolve the mounted provider or fail with the documented message.
   * @returns The active overlay provider.
   */
  private static provider(): NonNullable<typeof window.overlayProvider> {
    if (typeof window === 'undefined' || !window.overlayProvider) throw new Error(REQUIRED_MESSAGE)
    return window.overlayProvider
  }

  /**
   * Attach modal listeners to the native `<dialog>` root only and keep the row's ref current.
   * @param node - The dialog element from the root ref, or null on unmount.
   */
  #setDialogNode(node: HTMLDialogElement | null): void {
    if (node === this.#dialogNode) return

    this.#unbindModalListeners()
    this.#dialogNode = node

    if (!node || node.tagName !== 'DIALOG') return

    node.addEventListener('keydown', this.#boundNativeEscapeKeyDown)
    node.addEventListener('cancel', this.#handleNativeCancel)
    node.addEventListener('click', this.#handleClick)
    this.#escapeKeydownListenerNode = node
    this.#cancelListenerNode = node
    this.#clickListenerNode = node
  }

  #boundNativeEscapeKeyDown = (event: Event): void => {
    if (event.defaultPrevented) return
    if (!(event instanceof KeyboardEvent) || event.key !== Keyboard.Escape) return
    this.#handleKeyboardShortcut(event)
  }

  #handleNativeCancel = (event: Event): void => {
    event.preventDefault()
    if (!this.props.active) return
    if (this.#escapeCloseHandled) return
    this.props.onRequestDismiss()
  }

  #handleClick = (event: MouseEvent): void => {
    if (!this.props.active) return

    const node = this.#dialogNode
    if (!node || event.target !== node) return

    const rect = node.getBoundingClientRect()
    const inside = event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom

    if (inside) return

    event.preventDefault()
    this.props.onRequestDismiss()
  }

  #unbindModalListeners(): void {
    if (this.#escapeKeydownListenerNode) {
      this.#escapeKeydownListenerNode.removeEventListener('keydown', this.#boundNativeEscapeKeyDown)
      this.#escapeKeydownListenerNode = null
    }
    if (this.#cancelListenerNode) {
      this.#cancelListenerNode.removeEventListener('cancel', this.#handleNativeCancel)
      this.#cancelListenerNode = null
    }
    if (this.#clickListenerNode) {
      this.#clickListenerNode.removeEventListener('click', this.#handleClick)
      this.#clickListenerNode = null
    }
  }

  #bindDialogRef = (node: HTMLDialogElement | null): void => {
    const { nodeRef } = this.props
    if (nodeRef) (nodeRef as MutableRefObject<HTMLDialogElement | null>).current = node
    this.#setDialogNode(node)
    if (node) this.#syncModalOpenState()
  }

  componentDidMount(): void {
    super.componentDidMount()
    this.#syncModalOpenState()
  }

  componentDidUpdate(prevProps: Readonly<Props<unknown>>, prevState: Readonly<object>): void {
    super.componentDidUpdate(prevProps, prevState)
    if (prevProps.id !== this.props.id) this.#syncModalOpenState()
  }

  componentWillUnmount(): void {
    this.#unmounted = true
    this.#unbindModalListeners()
    this.#dialogNode = null
    super.componentWillUnmount()
  }

  override render(): ReactNode {
    const Tag = this.tag
    const { className } = this.props

    return (
      <Tag
        ref={this.#bindDialogRef}
        {...this.attributes}
        className={classNames(className, this.classNames)}
      >
        {this.content()}
      </Tag>
    )
  }

  #syncModalOpenState(): void {
    if (this.#unmounted) return

    const node = this.#dialogNode ?? this.rootNode as HTMLDialogElement | null
    if (!node) {
      requestAnimationFrame(() => this.#syncModalOpenState())
      return
    }

    if (!node.open) {
      if (typeof node.showModal === 'function') node.showModal()
      else node.setAttribute('open', '')
    }

    if (!node.contains(document.activeElement)) node.focus()
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-active': this.props.active,
      'data-intent': this.props.intent ?? Dialog.Intent.Default,
      'onKeyDown': this.#handleKeyDown,
      'tabIndex': -1,
    }
  }

  #activateButtonAt = (index: number): void => {
    const button = this.props.buttons[index]
    if (!button) return
    this.props.onActivateButton(button, index)
  }

  #handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>): void => {
    this.#handleKeyboardShortcut(event)
  }

  #handleKeyboardShortcut(event: KeyboardEvent | ReactKeyboardEvent<HTMLDialogElement>): void {
    if (event.defaultPrevented) return
    if (!this.props.active) return

    if (event.key === Keyboard.Escape) {
      event.preventDefault()
      this.#escapeCloseHandled = true
      this.props.onRequestDismiss()
      queueMicrotask(() => { this.#escapeCloseHandled = false })
      return
    }

    if (event.key !== Keyboard.Enter) return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (this.props.busy) return

    const index = dialogDefaultButtonIndex(this.props.buttons)
    if (index === null) return

    event.preventDefault()
    this.#activateButtonAt(index)
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
    return <IntentIcon intent={intent} />
  }

  content(): ReactNode {
    const { buttons, content, title } = this.props

    return (
      <>
        <header>
          {this.icon}
          {title}
        </header>
        <section>
          {content}
        </section>
        {buttons.length > 0 && (
          <footer>
            {buttons.map((button, index) => this.renderButton(button, index))}
          </footer>
        )}
      </>
    )
  }

  private renderButton(button: DialogButton<unknown>, index: number): ReactNode {
    const { busy, onActivateButton } = this.props

    if (isValidElement(button)) {
      const props = button.props
      return cloneElement(button, {
        'data-intent': props['data-intent'] ?? Dialog.Intent.Default,
        'disabled': busy || props.disabled,
        'key': index,
        'onActivate': (event: SyntheticEvent) => {
          props.onActivate?.(event)
          onActivateButton(button, index)
        },
        'type': props.type ?? Button.Type.Button,
      } as Partial<typeof props> & { key: number })
    }

    return (
      <Button
        key={index}
        data-intent={button.intent ?? Dialog.Intent.Default}
        disabled={busy}
        type={Button.Type.Button}
        onActivate={() => onActivateButton(button, index)}
      >
        {button.label}
      </Button>
    )
  }
}
