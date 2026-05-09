import type { DialogEntry } from './DialogEntry'
import type { ToastEntry } from './ToastEntry'

export interface OverlayProviderState {
  activeDialog: DialogEntry | null,
  dialogQueue: DialogEntry[],
  toasts: ToastEntry[],
}
