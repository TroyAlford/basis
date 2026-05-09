import type { ReactNode } from 'react'
import type { Dialog } from './Dialog'

export interface DialogButton<T> {
  intent?: Dialog.Intent,
  label: ReactNode,
  value: T,
}
