import type { ReactNode } from 'react'
import type { DialogButton } from './DialogButton'

export interface DialogRequest<T = unknown> {
  buttons: DialogButton<T>[],
  cancelValue: T,
  content?: ReactNode,
  title?: ReactNode,
}
