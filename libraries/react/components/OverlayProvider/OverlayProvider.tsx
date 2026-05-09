import type { ReactNode } from 'react'
import { createRef } from 'react'
import { Component } from '../Component/Component'
import type { DialogQueued, DialogRequest } from './Dialog'
import { Dialog } from './Dialog'
import { Dialogs } from './Dialogs'
import type { NotificationHandle, NotificationQueued, NotificationRequest } from './Notification'
import { Notification } from './Notification'
import { Notifications } from './Notifications'
import { NotificationStatus } from './NotificationStatus'

interface OverlayHostState {
  activeDialog: DialogQueued | null,
  dialogQueue: DialogQueued[],
  notifications: NotificationQueued[],
}

export class OverlayProvider extends Component<object, HTMLDivElement, OverlayHostState> {
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

  get defaultState(): OverlayHostState {
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
    if (typeof window !== 'undefined' && window.overlayProvider === this) {
      window.overlayProvider = undefined
    }
    this.#notificationTimeouts.forEach(timeout => clearTimeout(timeout))
    this.#notificationTimeouts.clear()
    super.componentWillUnmount()
  }

  createNotification(request: Partial<NotificationRequest>): NotificationHandle {
    const entry: NotificationQueued = {
      status: NotificationStatus.Info,
      timeout: null,
      ...request,
      id: OverlayProvider.createId('notification'),
    }

    this.setState(state => ({
      notifications: [...state.notifications, entry],
    }), () => this.#scheduleNotification(entry))

    return {
      dismiss: () => this.#dismissNotification(entry.id),
      id: entry.id,
      update: update => this.#updateNotification(entry.id, update),
    }
  }

  openDialog<T>(request: DialogRequest<T>): Promise<T> {
    return new Promise<T>(resolve => {
      const entry: DialogQueued<T> = {
        ...request,
        id: OverlayProvider.createId('dialog'),
        nodeRef: createRef<HTMLDialogElement>(),
        resolve,
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
    activeDialog.resolve(value)

    this.setState(state => {
      const [nextDialog, ...dialogQueue] = state.dialogQueue
      return {
        activeDialog: nextDialog ?? null,
        dialogQueue,
      }
    })
  }

  #scheduleNotification(row: NotificationQueued): void {
    const current = this.#notificationTimeouts.get(row.id)
    if (current) clearTimeout(current)
    this.#notificationTimeouts.delete(row.id)

    if (typeof row.timeout !== 'number') return
    this.#notificationTimeouts.set(row.id, setTimeout(() => {
      this.#dismissNotification(row.id)
    }, row.timeout))
  }

  #updateNotification(id: string, update: Partial<NotificationRequest>): void {
    let updated: NotificationQueued | undefined
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
              row={row}
              onDismiss={() => this.#dismissNotification(row.id)}
            />
          ))}
        </Notifications>
        <Dialogs>
          {activeDialog && (
            <Dialog
              key={activeDialog.id}
              dialog={activeDialog}
              nodeRef={activeDialog.nodeRef}
              onResolve={this.#resolveDialog}
            />
          )}
        </Dialogs>
      </>
    )
  }
}

export type OverlayProviderState = InstanceType<typeof OverlayProvider>['state']
