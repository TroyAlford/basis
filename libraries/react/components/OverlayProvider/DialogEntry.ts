import type { RefObject } from 'react'
import type { DialogRequest } from './DialogRequest'

export interface DialogEntry<T = unknown> extends DialogRequest<T> {
  id: string,
  nodeRef: RefObject<HTMLDialogElement | null>,
  resolve: (value: T) => void,
}
