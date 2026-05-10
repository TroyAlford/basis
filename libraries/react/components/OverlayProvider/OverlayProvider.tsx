import type { ReactNode } from 'react'
import { createRef } from 'react'
import { Intent } from '../../types/Intent'
import { Component } from '../Component/Component'
import type { DialogButton, DialogDefaultValue, IDialog } from './Dialog'
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

  static #nextId = 0

  /**
   * Process-unique id for queued overlay rows (dialogs and notifications).
   * @param prefix - Short label prefix (for example `dialog` or `notification`).
   * @returns A unique string id prefixed with {@link prefix}.
   */
  static createId(prefix: string): string {
    return `${prefix}-${++OverlayProvider.#nextId}`
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
  }

  componentWillUnmount(): void {
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
      id: OverlayProvider.createId('notification'),
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

  openDialog<T = DialogDefaultValue>(
    request: Partial<Omit<IDialog<T>, 'id' | 'nodeRef' | 'onResolve'>> = {},
  ): Promise<T | DialogDefaultValue> {
    const defaultButtons: DialogButton<DialogDefaultValue | false>[] = [
      { intent: Intent.Default, label: 'Cancel', value: false },
      { intent: Intent.Primary, label: 'OK', value: 'confirm' },
    ]
    const hasCustomButtons = Array.isArray(request.buttons) && request.buttons.length > 0
    const buttons = hasCustomButtons
      ? request.buttons as DialogButton<T | DialogDefaultValue>[]
      : defaultButtons

    return new Promise<T | DialogDefaultValue>(resolve => {
      const entry: Dialog['props'] = {
        buttons,
        content: request.content ?? null,
        icon: request.icon ?? null,
        id: OverlayProvider.createId('dialog'),
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

export type OverlayProviderState = InstanceType<typeof OverlayProvider>['state']
