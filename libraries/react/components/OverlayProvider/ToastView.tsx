import type { ReactNode } from 'react'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Toast } from './Toast'
import type { ToastEntry } from './ToastEntry'

interface Props {
  onDismiss: () => void,
  toast: ToastEntry,
}

/**
 * Renders one non-modal toast notification.
 */
export class ToastView extends Component<Props, HTMLElement> {
  static displayName = 'ToastView'

  get attributes() {
    const { toast } = this.props
    return {
      ...super.attributes,
      'data-status': toast.status ?? Toast.Status.Info,
    }
  }

  get tag() {
    return 'aside' as const
  }

  content(): ReactNode {
    const { onDismiss, toast } = this.props
    return (
      <>
        {toast.title && <header>{toast.title}</header>}
        {toast.content && <div>{toast.content}</div>}
        <Button
          aria-label="Dismiss notification"
          type={Button.Type.Button}
          onActivate={onDismiss}
        >
          x
        </Button>
      </>
    )
  }
}
