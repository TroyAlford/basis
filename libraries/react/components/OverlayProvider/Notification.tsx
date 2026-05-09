import type { ReactNode } from 'react'
import { match } from '@basis/utilities/index.ts'
import { Remove, Warning } from '../../icons'
import { Intent } from '../../types/Intent'
import { Component } from '../Component/Component'

import './Notification.styles.ts'

const overlayHostRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Notification.create().',
].join(' ')

/** Payload for {@link Notification.create} and rows owned by {@link OverlayProvider} (before `id`). */
export interface INotification {
  content?: ReactNode,
  intent?: Intent,
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

  static readonly Intent = Intent

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
    const { intent } = this.props
    return {
      ...super.attributes,
      'data-intent': intent ?? Notification.Intent.Default,
    }
  }

  get tag() {
    return 'aside' as const
  }

  get icon() {
    const intent = this.props.intent ?? Notification.Intent.Default
    return match(intent)
      .when(Notification.Intent.Danger).then(<Warning filled title="Warning" />)
      .else(null)
  }

  content(): ReactNode {
    const { content, onDismiss, title } = this.props
    return (
      <>
        <header>
          {this.icon}
          {title ?? null}
        </header>
        {content && <section>{content}</section>}
        <Remove onClick={onDismiss} />
      </>
    )
  }
}
