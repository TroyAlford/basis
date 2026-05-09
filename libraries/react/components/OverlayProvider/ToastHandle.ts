import type { ToastRequest } from './ToastRequest'

export interface ToastHandle {
  dismiss(): void,
  id: string,
  update(update: Partial<ToastRequest>): void,
}
