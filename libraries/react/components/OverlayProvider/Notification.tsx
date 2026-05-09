import type { ReactNode } from 'react'
import { Remove } from '@basis/react/icons'
import { Component } from '../Component/Component'

import './Notification.styles.ts'

const overlayHostRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Notification.create().',
].join(' ')

enum Status {
  Error = 'error',
  Info = 'info',
  Loading = 'loading',
  Success = 'success',
  Warning = 'warning',
}

/** Payload for {@link Notification.create} and rows owned by {@link OverlayProvider} (before `id`). */
export interface INotification {
  content?: ReactNode,
  status?: Status,
  timeout?: number | null,
  title?: ReactNode,
}

interface Props extends INotification {
  id: string,
  onDismiss: () => void,
}

/**
 * In-app notification: static {@link Notification.create} and mounted rows inside {@link OverlayProvider}.
 */
export class Notification extends Component<Props, HTMLElement> {
  static displayName = 'Notification'

  static readonly Status = Status

  /**
   * @param request - Typically `Partial<INotification>`. Import `type { INotification }` from this
   *   module; it is not re-exported from `@basis/react`.
   * @returns Handle for update and dismiss (shape follows {@link OverlayProvider.createNotification}).
   */
  static create(request: Partial<INotification>) {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(overlayHostRequiredMessage)
    }
    return window.overlayProvider.createNotification(request)
  }

  get attributes() {
    const { status } = this.props
    return {
      ...super.attributes,
      'data-status': status ?? Notification.Status.Info,
    }
  }

  get tag() {
    return 'aside' as const
  }

  content(): ReactNode {
    const { content, onDismiss, title } = this.props
    return (
      <>
        {title && <header>{title}</header>}
        {content && <section>{content}</section>}
        <Remove onClick={onDismiss} />
      </>
    )
  }
}
