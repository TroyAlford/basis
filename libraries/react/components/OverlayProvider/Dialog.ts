import type { ReactNode } from 'react'
import type { DialogRequest } from './DialogRequest'
import { overlayProviderRequiredMessage } from './OverlayProviderRegistry'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Dialog {
  static open<T>(request: DialogRequest<T>): Promise<T> {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(overlayProviderRequiredMessage)
    }
    return window.overlayProvider.openDialog(request)
  }

  static confirm({
    cancelLabel = 'Cancel',
    confirmLabel = 'Confirm',
    content,
    danger = false,
    title,
  }: {
    cancelLabel?: ReactNode,
    confirmLabel?: ReactNode,
    content?: ReactNode,
    danger?: boolean,
    title?: ReactNode,
  }): Promise<boolean> {
    return Dialog.open<boolean>({
      buttons: [
        { intent: Dialog.Intent.Default, label: cancelLabel, value: false },
        {
          intent: danger ? Dialog.Intent.Danger : Dialog.Intent.Primary,
          label: confirmLabel,
          value: true,
        },
      ],
      cancelValue: false,
      content,
      title,
    })
  }
}

// Merged namespace exposes `Dialog.Intent` on the `Dialog` class (TypeScript pattern).
// eslint-disable-next-line @typescript-eslint/no-namespace -- nested public API on Dialog
export namespace Dialog {
  export enum Intent {
    Danger = 'danger',
    Default = 'default',
    Primary = 'primary',
  }
}
