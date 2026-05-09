import type { ReactNode } from 'react'
import { Remove } from '@basis/react/icons'
import { Component } from '../Component/Component'
import { NotificationStatus } from './NotificationStatus'

import './Notification.styles.ts'

const overlayHostRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Notification.create().',
].join(' ')

export interface NotificationRequest {
  content?: ReactNode,
  status?: NotificationStatus,
  timeout?: number | null,
  title?: ReactNode,
}

export interface NotificationHandle {
  dismiss(): void,
  id: string,
  update(update: Partial<NotificationRequest>): void,
}

interface HostProps {
  onDismiss: () => void,
  row: NotificationQueued,
}

/**
 * In-app notification: static {@link Notification.create} and mounted rows inside {@link OverlayProvider}.
 */
export class Notification extends Component<HostProps, HTMLElement> {
  static displayName = 'Notification'

  static readonly Status = NotificationStatus

  static create(request: Partial<NotificationRequest>): NotificationHandle {
    if (typeof window === 'undefined' || !window.overlayProvider) {
      throw new Error(overlayHostRequiredMessage)
    }
    return window.overlayProvider.createNotification(request)
  }

  get attributes() {
    const { row } = this.props
    return {
      ...super.attributes,
      'data-status': row.status ?? NotificationStatus.Info,
    }
  }

  get tag() {
    return 'aside' as const
  }

  content(): ReactNode {
    const { onDismiss, row } = this.props
    return (
      <>
        {row.title && <header>{row.title}</header>}
        {row.content && <section>{row.content}</section>}
        <Remove onClick={onDismiss} />
      </>
    )
  }
}

/** Notification row as queued by {@link OverlayProvider} (request fields plus `id`). */
export type NotificationQueued = NotificationRequest & { id: string }
