import type { ComponentClass, ReactNode } from 'react'
import type { RefObject } from 'react'
import { createElement, createRef, isValidElement } from 'react'
import { Intent } from '../../types/Intent'
import { createId } from '../../utilities/createId'
import { Component } from '../Component/Component'
import type { DialogButton, DialogEditorState, DialogHandle, DialogOptions, DialogRequest } from './Dialog'
import { Dialog } from './Dialog'
import { Dialogs } from './Dialogs'
import type { INotification, NotificationHandle } from './Notification'
import { Notification } from './Notification'
import { Notifications } from './Notifications'
import { OverlayEntry } from './OverlayLifecycle'
import { REQUIRED_MESSAGE } from './REQUIRED_MESSAGE.ts'

interface State {
  /** Mounted native dialogs, bottom to top. */
  dialogs: DialogRow<unknown>[],
  /** Live notifications, oldest first. */
  notifications: NotificationRow[],
}

/** Shell and lifecycle options an editor dialog handle may update. */
const EDITOR_UPDATE_KEYS: ReadonlySet<string> = new Set([
  'buttons',
  'className',
  'icon',
  'intent',
  'onDismissed',
  'onDismissing',
  'onError',
  'onResolved',
  'onResolving',
  'style',
  'title',
])

interface EntryHooks<Value> {
  onRemove: () => Promise<void> | void,
  onSettled: (result: Value | false) => void,
  prepareDismiss?: () => Promise<boolean>,
}

/** A provider-owned dialog stack row. */
class DialogRow<Value = unknown> extends OverlayEntry<Value> {
  readonly nodeRef: RefObject<HTMLDialogElement | null> = createRef<HTMLDialogElement>()

  busyAction: Promise<void> | null = null

  focusBefore: HTMLElement | null = null

  constructor(request: DialogRequest<Value>, hooks: EntryHooks<Value>) {
    super({ kind: 'dialog', options: request, ...hooks })
  }

  /**
   * The current normalized dialog request.
   * @returns The latest dialog options.
   */
  get request(): DialogRequest<Value> {
    return this.options as unknown as DialogRequest<Value>
  }

  /**
   * The managed editor state, when this row is an editor dialog.
   * @returns The editor state, or undefined for a regular dialog.
   */
  get editor(): DialogEditorState<Value> | undefined {
    return this.request.editor
  }
}

/** A provider-owned notification row. */
class NotificationRow extends OverlayEntry<never> {
  constructor(options: INotification, hooks: EntryHooks<never>) {
    super({ kind: 'notification', options, ...hooks })
  }

  /**
   * The current notification options.
   * @returns The latest notification options.
   */
  get notification(): INotification {
    return this.options as unknown as INotification
  }
}

/**
 * The single host for dialogs and notifications. Both overlay kinds share this provider's
 * registration, update, terminal-transition, callback, and cleanup lifecycle while keeping
 * type-specific rendering: native modal stacking for dialogs, independent live regions for
 * notifications.
 */
export class OverlayProvider extends Component<object, HTMLDivElement, State> {
  static displayName = 'OverlayProvider'

  /**
   * Process-unique id for overlay rows (dialogs and notifications).
   * @returns A short hash string (stable length) for React keys and DOM ids.
   */
  static createId(): string {
    return createId()
  }

  #dialogOrder: DialogRow<unknown>[] = []

  #notificationTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

  #releases = new Set<() => void>()

  #teardown = false

  get defaultState(): State {
    return {
      dialogs: [],
      notifications: [],
    }
  }

  constructor(props: object) {
    super(props)
    if (typeof window !== 'undefined') window.overlayProvider = this
  }

  componentDidMount(): void {
    super.componentDidMount()
    if (typeof window !== 'undefined') window.overlayProvider = this
  }

  componentWillUnmount(): void {
    this.#teardown = true
    this.state.dialogs.forEach(row => row.forceDismiss())
    this.state.notifications.forEach(row => row.forceDismiss())
    this.#dialogOrder = []
    this.#releases.forEach(release => release())
    this.#releases.clear()
    this.#notificationTimeouts.forEach(timeout => clearTimeout(timeout))
    this.#notificationTimeouts.clear()
    if (typeof window !== 'undefined' && window.overlayProvider === this) {
      window.overlayProvider = undefined
    }
    super.componentWillUnmount()
  }

  override shouldComponentUpdate(): boolean {
    return true
  }

  /**
   * Register a normalized dialog request and return its managed handle.
   * @param request - Fully normalized request from a {@link Dialog} helper.
   * @returns The awaitable handle tied to the mounted row.
   */
  openDialog<Value = boolean>(request: DialogRequest<Value>): DialogHandle<Value> {
    let settle!: (result: Value | false) => void
    const done = new Promise<Value | false>(resolve => { settle = resolve })

    const row: DialogRow<Value> = new DialogRow<Value>(request, {
      onRemove: () => this.#removeDialog(row),
      onSettled: settle,
      prepareDismiss: request.editor
        ? () => this.#confirmEditorDiscard(row)
        : undefined,
    })

    row.focusBefore = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    this.#dialogOrder.push(row as DialogRow<unknown>)
    this.setState(state => ({ dialogs: [...state.dialogs, row as DialogRow<unknown>] }))

    return Object.assign(done, {
      dismiss: () => this.#requestDialogDismiss(row),
      id: row.id,
      resolve: (value: Value) => this.#requestDialogResolve(row, value),
      update: (options: Partial<DialogOptions<Value>>) => this.#updateDialog(row, options),
    })
  }

  /**
   * Register a notification request and return its update/dismiss handle.
   * @param request - Partial notification options.
   * @returns The notification handle tied to the mounted row.
   */
  createNotification(request: Partial<INotification>): NotificationHandle {
    const options: INotification = {
      content: request.content,
      icon: request.icon,
      intent: request.intent ?? Intent.Default,
      onDismissed: request.onDismissed,
      onDismissing: request.onDismissing,
      onError: request.onError,
      timeout: request.timeout ?? null,
      title: request.title,
    }

    const row: NotificationRow = new NotificationRow(options, {
      onRemove: () => this.#removeNotification(row),
      onSettled: () => undefined,
    })

    this.setState(
      state => ({ notifications: [...state.notifications, row] }),
      () => this.#scheduleNotification(row),
    )

    return {
      dismiss: () => this.#requestNotificationDismiss(row),
      id: row.id,
      update: (update: Partial<INotification>) => this.#updateNotification(row, update),
    }
  }

  /**
   * Merge a partial update into a dialog row. Editor rows split typed editor props from shell
   * options so the mounted editor keeps its identity.
   * @param row - Dialog row.
   * @param patch - Partial options to merge.
   */
  #updateDialog<Value>(row: DialogRow<Value>, patch: Partial<DialogOptions<Value>>): void {
    if (row.settled) return

    const entries = Object.entries(patch as Record<string, unknown>)

    if (row.editor) {
      const shell: Record<string, unknown> = {}
      for (const [key, value] of entries) {
        if (key !== 'props' && EDITOR_UPDATE_KEYS.has(key)) shell[key] = value
      }

      if (Object.keys(shell).length > 0) {
        row.options = {
          ...row.options,
          ...shell,
        } as unknown as DialogRequest<Value>
      }

      const unsafeProps = (patch as { props?: Record<string, unknown> }).props
      if (unsafeProps) {
        const props = { ...unsafeProps }
        delete props.content
        delete props.editor
        delete props.initialValue
        row.editor.updateProps(props)
      }

      this.forceUpdate()
      return
    }

    const shell = { ...patch }
    delete (shell as { props?: unknown }).props

    if (Object.keys(shell).length > 0) {
      row.options = {
        ...row.options,
        ...shell,
      } as unknown as DialogRequest<Value>
    }

    this.forceUpdate()
  }

  /**
   * Request dismissal for a dialog, enforcing topmost and busy-action rules.
   * @param row - Dialog row.
   * @returns Whether the dismissal was accepted.
   */
  #requestDialogDismiss<Value>(row: DialogRow<Value>): Promise<boolean> {
    if (row.settled || row.busyAction || !this.#isTopDialog(row)) return Promise.resolve(false)
    return row.dismiss()
  }

  /**
   * Request resolution for a dialog, enforcing topmost and busy-action rules.
   * @param row - Dialog row.
   * @param value - Resolution value.
   * @returns Whether the resolution was accepted.
   */
  #requestDialogResolve<Value>(row: DialogRow<Value>, value: Value): Promise<boolean> {
    if (row.settled || row.busyAction || !this.#isTopDialog(row)) return Promise.resolve(false)
    return row.resolve(value)
  }

  /**
   * Activate a footer button: persistent action, dismissal, or resolution.
   * @param row - Dialog row.
   * @param button - Activated button.
   */
  #activateDialogButton<Value>(row: DialogRow<Value>, button: DialogButton<Value>): void {
    if (row.settled || row.busyAction || !this.#isTopDialog(row)) return

    if (!isValidElement(button) && 'action' in button) {
      void this.#runDialogAction(row, button.action)
      return
    }

    if (isValidElement(button)) {
      const value = button.props['data-value'] as Value | false
      if (value === false) void row.dismiss().catch(() => undefined)
      else void row.resolve(value as Value).catch(() => undefined)
      return
    }

    const definition = button as
      | { action?: never, label: ReactNode, resolve: () => Value, value?: never }
      | { action?: never, label: ReactNode, resolve?: never, value: Value }

    if ('resolve' in definition && typeof definition.resolve === 'function') {
      let value: Value
      try {
        value = definition.resolve()
      } catch (error) {
        row.reportError(error)
        return
      }
      void row.resolve(value).catch(() => undefined)
      return
    }

    const value = (definition as { value: Value }).value
    if (value === false) void row.dismiss().catch(() => undefined)
    else void row.resolve(value).catch(() => undefined)
  }

  /**
   * Run a persistent action at most once concurrently. The dialog stays mounted; a failure is
   * reported and remains retryable.
   * @param row - Dialog row.
   * @param action - Action callback.
   */
  async #runDialogAction<Value>(row: DialogRow<Value>, action: () => void | Promise<void>): Promise<void> {
    if (row.settled || row.busyAction || row.transition) return

    const running = (async () => {
      // Let the caller publish the busy state before the action can settle synchronously.
      await Promise.resolve()

      try {
        await action()
      } catch (error) {
        row.reportError(error)
      } finally {
        row.busyAction = null
        this.forceUpdate()
      }
    })()

    row.busyAction = running
    this.forceUpdate()
    await running
  }

  /**
   * Built-in editor dirty guard. A clean editor dismisses immediately; a dirty editor asks for
   * confirmation through the same managed modal stack.
   * @param row - Editor dialog row.
   * @returns Whether dismissal may continue.
   */
  async #confirmEditorDiscard<Value>(row: DialogRow<Value>): Promise<boolean> {
    const editor = row.editor
    if (!editor || !editor.dirty) return true

    return await Dialog.confirm({
      content: 'You have unsaved changes. Discard them?',
      intent: Intent.Danger,
      labelCancel: 'Keep editing',
      labelConfirm: 'Discard',
      title: 'Discard changes?',
    })
  }

  /**
   * Request dismissal for a notification.
   * @param row - Notification row.
   * @returns Whether the dismissal was accepted.
   */
  #requestNotificationDismiss(row: NotificationRow): Promise<boolean> {
    if (row.settled) return Promise.resolve(false)
    return row.dismiss()
  }

  /**
   * Apply a notification update. Only an explicit `timeout` key re-arms the timer.
   * @param row - Notification row.
   * @param update - Partial notification options.
   */
  #updateNotification(row: NotificationRow, update: Partial<INotification>): void {
    if (row.settled) return

    row.options = { ...row.options, ...update }
    this.forceUpdate()
    if (Object.hasOwn(update, 'timeout')) this.#scheduleNotification(row)
  }

  /**
   * Arm or cancel a notification timer from its current options.
   * @param row - Notification row.
   */
  #scheduleNotification(row: NotificationRow): void {
    const current = this.#notificationTimeouts.get(row.id)
    if (current) clearTimeout(current)
    this.#notificationTimeouts.delete(row.id)

    const { timeout } = row.notification
    if (typeof timeout !== 'number') return
    if (row.settled) return

    this.#notificationTimeouts.set(row.id, setTimeout(() => {
      this.#notificationTimeouts.delete(row.id)
      void row.dismiss().catch(() => undefined)
    }, timeout))
  }

  /**
   * Remove a settled dialog row, close its native node, and restore focus.
   * @param row - Dialog row.
   * @returns A promise resolved after the row is removed and focus is restored.
   */
  #removeDialog(row: DialogRow<unknown>): Promise<void> {
    this.#dialogOrder = this.#dialogOrder.filter(candidate => candidate !== row)

    const node = row.nodeRef.current
    if (node?.open) node.close()

    if (this.#teardown) return Promise.resolve()

    return new Promise<void>(resolve => {
      const release = (): void => {
        this.#releases.delete(release)
        resolve()
      }

      this.#releases.add(release)
      this.setState(
        state => ({ dialogs: state.dialogs.filter(candidate => candidate !== row) }),
        () => {
          this.#restoreFocus(row)
          release()
        },
      )
    })
  }

  /**
   * Remove a settled notification row, release its timer, and wait for the React commit.
   * @param row - Notification row.
   * @returns A promise resolved after the row is removed from the provider state.
   */
  #removeNotification(row: NotificationRow): Promise<void> {
    const timeout = this.#notificationTimeouts.get(row.id)
    if (timeout) clearTimeout(timeout)
    this.#notificationTimeouts.delete(row.id)

    if (this.#teardown) return Promise.resolve()

    return new Promise<void>(resolve => {
      const release = (): void => {
        this.#releases.delete(release)
        resolve()
      }

      this.#releases.add(release)
      this.setState(
        state => ({
          notifications: state.notifications.filter(candidate => candidate !== row),
        }),
        release,
      )
    })
  }

  /**
   * Restore focus to the prior element in the remaining top dialog, or to the original trigger.
   * @param row - The dialog row that just closed.
   */
  #restoreFocus(row: DialogRow<unknown>): void {
    if (this.#teardown) return

    const { dialogs } = this.state
    if (dialogs.length === 0) {
      if (row.focusBefore?.isConnected) row.focusBefore.focus()
      return
    }

    const top = dialogs[dialogs.length - 1]
    const topNode = top.nodeRef.current

    if (row.focusBefore?.isConnected && topNode?.contains(row.focusBefore)) {
      row.focusBefore.focus()
      return
    }

    topNode?.focus()
  }

  /**
   * Whether a row is the topmost dialog.
   * @param row - Dialog row.
   * @returns True for the last mounted dialog.
   */
  #isTopDialog(row: DialogRow<unknown>): boolean {
    return this.#dialogOrder[this.#dialogOrder.length - 1] === row
  }

  /**
   * Render an editor row's component with controlled value handling. Props and value updates
   * re-render React's existing mounted instance rather than replacing it.
   * @param row - Editor dialog row.
   * @returns The mounted editor element.
   */
  #renderEditor<Value>(row: DialogRow<Value>): ReactNode {
    const editor = row.editor
    if (!editor) return null

    const consumerChange = editor.props.onChange as
      | ((value: Value, field: string, instance: unknown) => void)
      | undefined

    return createElement(
      editor.Component as unknown as ComponentClass<Record<string, unknown>>,
      {
        ...editor.props,
        initialValue: editor.baseline,
        onChange: (next: Value, field: string, instance: unknown) => {
          editor.value = next
          try {
            consumerChange?.(next, field, instance)
          } finally {
            this.forceUpdate()
          }
        },
        value: editor.value,
      },
    )
  }

  content(): ReactNode {
    const { dialogs, notifications } = this.state
    const top = dialogs.length - 1

    return (
      <>
        <Notifications>
          {notifications.map(row => (
            <Notification
              key={row.id}
              {...row.notification}
              id={row.id}
              onDismiss={() => { void this.#requestNotificationDismiss(row).catch(() => undefined) }}
            />
          ))}
        </Notifications>
        <Dialogs>
          {dialogs.map((row, index) => (
            <Dialog
              key={row.id}
              {...row.request}
              active={index === top}
              busy={!!row.busyAction}
              buttons={row.request.buttons}
              content={row.editor ? this.#renderEditor(row) : row.request.content}
              id={row.id}
              nodeRef={row.nodeRef}
              onActivateButton={button => this.#activateDialogButton(row, button)}
              onRequestDismiss={() => { void this.#requestDialogDismiss(row).catch(() => undefined) }}
            />
          ))}
        </Dialogs>
      </>
    )
  }
}

/**
 * Read the active overlay provider or fail with the documented message.
 * @returns The mounted provider.
 */
export function requireOverlayProvider(): OverlayProvider {
  if (typeof window === 'undefined' || !window.overlayProvider) throw new Error(REQUIRED_MESSAGE)
  return window.overlayProvider
}
