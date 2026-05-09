import type { ReactNode } from 'react'
import type { Toast } from './Toast'

export interface ToastRequest {
  content?: ReactNode,
  status?: Toast.Status,
  timeout?: number | null,
  title?: ReactNode,
}
