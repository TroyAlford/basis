import type { ReactNode } from 'react'
import { createRef } from 'react'
import { Component } from '../Component/Component'
import type { DialogEntry } from './DialogEntry'
import type { DialogRequest } from './DialogRequest'
import { DialogView } from './DialogView'
import { OverlayDialogRegion } from './OverlayDialogRegion'
import { createOverlayId } from './OverlayProviderRegistry'
import type { OverlayProviderState } from './OverlayProviderState'
import { OverlayToastRegion } from './OverlayToastRegion'
import { Toast } from './Toast'
import type { ToastEntry } from './ToastEntry'
import type { ToastHandle } from './ToastHandle'
import type { ToastRequest } from './ToastRequest'
import { ToastView } from './ToastView'

export class OverlayProvider extends Component<object, HTMLDivElement, OverlayProviderState> {
  static displayName = 'OverlayProvider'

  #toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

  get defaultState(): OverlayProviderState {
    return {
      activeDialog: null,
      dialogQueue: [],
      toasts: [],
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
    this.#toastTimeouts.forEach(timeout => clearTimeout(timeout))
    this.#toastTimeouts.clear()
    super.componentWillUnmount()
  }

  openDialog<T>(request: DialogRequest<T>): Promise<T> {
    return new Promise<T>(resolve => {
      const entry: DialogEntry<T> = {
        ...request,
        id: createOverlayId('dialog'),
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

  createToast(request: ToastRequest): ToastHandle {
    const entry: ToastEntry = {
      status: Toast.Status.Info,
      timeout: null,
      ...request,
      id: createOverlayId('toast'),
    }

    this.setState(state => ({
      toasts: [...state.toasts, entry],
    }), () => this.#scheduleToast(entry))

    return {
      dismiss: () => this.#dismissToast(entry.id),
      id: entry.id,
      update: update => this.#updateToast(entry.id, update),
    }
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

  #dismissToast(id: string): void {
    const timeout = this.#toastTimeouts.get(id)
    if (timeout) clearTimeout(timeout)
    this.#toastTimeouts.delete(id)

    this.setState(state => ({
      toasts: state.toasts.filter(toast => toast.id !== id),
    }))
  }

  #scheduleToast(toast: ToastEntry): void {
    const current = this.#toastTimeouts.get(toast.id)
    if (current) clearTimeout(current)
    this.#toastTimeouts.delete(toast.id)

    if (typeof toast.timeout !== 'number') return
    this.#toastTimeouts.set(toast.id, setTimeout(() => {
      this.#dismissToast(toast.id)
    }, toast.timeout))
  }

  #updateToast(id: string, update: Partial<ToastRequest>): void {
    let updatedToast: ToastEntry | undefined
    this.setState(state => {
      const toasts = state.toasts.map(toast => (
        toast.id === id
          ? { ...toast, ...update }
          : toast
      ))
      updatedToast = toasts.find(candidate => candidate.id === id)
      return { toasts }
    }, () => {
      if (updatedToast && Object.hasOwn(update, 'timeout')) this.#scheduleToast(updatedToast)
    })
  }

  content(): ReactNode {
    const { activeDialog, toasts } = this.state

    return (
      <>
        <OverlayToastRegion>
          {toasts.map(toast => (
            <ToastView
              key={toast.id}
              toast={toast}
              onDismiss={() => this.#dismissToast(toast.id)}
            />
          ))}
        </OverlayToastRegion>
        <OverlayDialogRegion>
          {activeDialog && (
            <DialogView
              key={activeDialog.id}
              dialog={activeDialog}
              nodeRef={activeDialog.nodeRef}
              onResolve={this.#resolveDialog}
            />
          )}
        </OverlayDialogRegion>
      </>
    )
  }
}
