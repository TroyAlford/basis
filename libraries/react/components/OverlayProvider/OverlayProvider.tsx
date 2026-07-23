import type { ReactNode } from 'react'
import { createRef } from 'react'
import { hash } from '@basis/utilities/functions/hash'
import { Intent } from '../../types/Intent'
import { Keyboard } from '../../types/Keyboard'
import { Component } from '../Component/Component'
import type { DialogButton, IDialog } from './Dialog'
import { Dialog } from './Dialog'
import { Dialogs } from './Dialogs'
import type { INotification } from './Notification'
import { Notification } from './Notification'
import { Notifications } from './Notifications'

type NotificationRow = INotification & { id: string }

interface State {
  activeDialog: Dialog['props'] | null,
  dialogQueue: Dialog['props'][],
  notifications: NotificationRow[],
}

export class OverlayProvider extends Component<object, HTMLDivElement, State> {
  static displayName = 'OverlayProvider'

  /**
   * Process-unique id for queued overlay rows (dialogs and notifications).
   * @returns A short hash string (stable length) for React keys and DOM ids.
   */
  static createId(): string {
    const raw = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}-${Math.random()}`
    return hash(raw, { length: 12 })
  }

  #notificationTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

  get defaultState(): State {
    return {
      activeDialog: null,
      dialogQueue: [],
      notifications: [],
    }
  }

  componentDidMount(): void {
    super.componentDidMount()
    if (typeof window !== 'undefined') window.overlayProvider = this
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.#handleDocumentKeyDown, true)
    }
  }

  componentWillUnmount(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.#handleDocumentKeyDown, true)
    }
    this.#resolvePendingDialogs()
    if (typeof window !== 'undefined' && window.overlayProvider === this) {
      window.overlayProvider = undefined
    }
    this.#notificationTimeouts.forEach(timeout => clearTimeout(timeout))
    this.#notificationTimeouts.clear()
    super.componentWillUnmount()
  }

  createNotification(request: Partial<INotification>) {
    const entry: NotificationRow = {
      content: request.content,
      icon: request.icon,
      id: OverlayProvider.createId(),
      intent: request.intent ?? Intent.Default,
      timeout: request.timeout ?? null,
      title: request.title,
    }

    this.setState(state => ({
      notifications: [...state.notifications, entry],
    }), () => this.#scheduleNotification(entry))

    return {
      dismiss: () => this.#dismissNotification(entry.id),
      id: entry.id,
      update: (update: Partial<INotification>) => this.#updateNotification(entry.id, update),
    }
  }

  openDialog<T = boolean>(request: Partial<Omit<IDialog<T>, 'id' | 'nodeRef' | 'onResolve'>> = {}): Promise<T | false> {
    const defaultButtons: DialogButton<boolean>[] = [
      { intent: Intent.Default, label: 'Cancel', value: false },
      { intent: Intent.Primary, label: 'OK', value: true },
    ]
    const hasCustomButtons = Array.isArray(request.buttons) && request.buttons.length > 0
    const buttons = hasCustomButtons
      ? request.buttons as DialogButton<T | false>[]
      : defaultButtons

    return new Promise<T | false>(resolve => {
      const entry: Dialog['props'] = {
        buttons,
        content: request.content ?? null,
        icon: request.icon ?? null,
        id: OverlayProvider.createId(),
        intent: request.intent ?? Intent.Primary,
        nodeRef: createRef<HTMLDialogElement>(),
        onResolve: resolve as (value: unknown) => void,
        title: request.title ?? null,
      }

      this.setState(state => (
        state.activeDialog
          ? { activeDialog: state.activeDialog, dialogQueue: [...state.dialogQueue, entry] }
          : { activeDialog: entry, dialogQueue: state.dialogQueue }
      ))
    })
  }

  #dismissNotification(id: string): void {
    const timeout = this.#notificationTimeouts.get(id)
    if (timeout) clearTimeout(timeout)
    this.#notificationTimeouts.delete(id)

    this.setState(state => ({
      notifications: state.notifications.filter(row => row.id !== id),
    }))
  }

  #resolveDialog = (value: unknown): void => {
    const { activeDialog } = this.state
    if (!activeDialog) return

    activeDialog.nodeRef.current?.close()
    activeDialog.onResolve(value)

    this.setState(state => {
      const [nextDialog, ...dialogQueue] = state.dialogQueue
      return {
        activeDialog: nextDialog ?? null,
        dialogQueue,
      }
    })
  }

  #handleDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
    if (event.key !== Keyboard.Escape) return

    const { activeDialog } = this.state
    if (!activeDialog) return

    const node = activeDialog.nodeRef.current
    if (!node?.open) return

    const target = event.target
    if (target instanceof Node && !node.contains(target)) return

    event.preventDefault()
    event.stopImmediatePropagation()
    this.#resolveDialog(false)
  }

  #resolvePendingDialogs(): void {
    const { activeDialog, dialogQueue } = this.state

    activeDialog?.nodeRef.current?.close()
    activeDialog?.onResolve(false)
    dialogQueue.forEach(row => row.onResolve(false))
    this.state.activeDialog = null
    this.state.dialogQueue = []
  }

  #scheduleNotification(row: NotificationRow): void {
    const current = this.#notificationTimeouts.get(row.id)
    if (current) clearTimeout(current)
    this.#notificationTimeouts.delete(row.id)

    if (typeof row.timeout !== 'number') return
    this.#notificationTimeouts.set(row.id, setTimeout(() => {
      this.#dismissNotification(row.id)
    }, row.timeout))
  }

  #updateNotification(id: string, update: Partial<INotification>): void {
    let updated: NotificationRow | undefined
    this.setState(state => {
      const notifications = state.notifications.map(row => (
        row.id === id
          ? { ...row, ...update }
          : row
      ))
      updated = notifications.find(candidate => candidate.id === id)
      return { notifications }
    }, () => {
      if (updated && Object.hasOwn(update, 'timeout')) this.#scheduleNotification(updated)
    })
  }

  content(): ReactNode {
    const { activeDialog, notifications } = this.state

    return (
      <>
        <Notifications>
          {notifications.map(row => (
            <Notification
              key={row.id}
              {...row}
              onDismiss={() => this.#dismissNotification(row.id)}
            />
          ))}
        </Notifications>
        <Dialogs>
          {activeDialog && (
            <Dialog
              key={activeDialog.id}
              {...activeDialog}
              onResolve={this.#resolveDialog}
            />
          )}
        </Dialogs>
      </>
    )
  }
}
