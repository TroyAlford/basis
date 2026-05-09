import { overlayProviderRequiredMessage } from './OverlayProviderRegistry'
import type { ToastHandle } from './ToastHandle'
import type { ToastRequest } from './ToastRequest'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Toast {
  static create(request: ToastRequest): ToastHandle {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(overlayProviderRequiredMessage)
    }
    return window.overlayProvider.createToast(request)
  }
}

// Merged namespace exposes `Toast.Status` on the `Toast` class (TypeScript pattern).
// eslint-disable-next-line @typescript-eslint/no-namespace -- nested public API on Toast
export namespace Toast {
  export enum Status {
    Error = 'error',
    Info = 'info',
    Loading = 'loading',
    Success = 'success',
    Warning = 'warning',
  }
}
