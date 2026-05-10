import type { ReactNode, RefObject } from 'react'
import { createRef } from 'react'
import { Intent } from '../../types/Intent'
import { Component } from '../Component/Component'
import type { IDialog } from './Dialog'
import { Dialog } from './Dialog'
import { Dialogs } from './Dialogs'
import type { INotification } from './Notification'
import { Notification } from './Notification'
import { Notifications } from './Notifications'

type DialogRow<T = unknown> = IDialog<T> & {
  id: string,
  nodeRef: RefObject<HTMLDialogElement | null>,
  resolve: (value: T) => void,
}

type NotificationRow = INotification & { id: string }

interface State {
  activeDialog: DialogRow | null,
  dialogQueue: DialogRow[],
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

  openDialog<T = unknown>(request: Partial<IDialog<T>>): Promise<T> {
    return new Promise<T>(resolve => {
      const entry: DialogRow<T> = {
        buttons: (request.buttons ?? []) as DialogRow<T>['buttons'],
        cancelValue: request.cancelValue as T,
        content: request.content,
        icon: request.icon,
        id: OverlayProvider.createId('dialog'),
        intent: request.intent,
        nodeRef: createRef<HTMLDialogElement>(),
        resolve,
        title: request.title,
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
