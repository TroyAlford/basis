import type { ReactNode } from 'react'
import { createElement } from 'react'
import { IconBase } from '@basis/react/icons/IconBase/IconBase'
import { Remove } from '../../icons'
import { Intent as IntentIcon } from '../../icons/Intent'
import { Intent } from '../../types/Intent'
import { Component } from '../Component/Component'

import './Notification.styles.ts'

const overlayHostRequiredMessage = [
  'OverlayProvider is not mounted.',
  'Render <OverlayProvider /> inside your React application tree before using Dialog.open() or Notification.create().',
].join(' ')

/** Payload for {@link Notification.create} and rows owned by {@link OverlayProvider} (before `id`). */
export interface INotification {
  /** Optional notification body. */
  content?: ReactNode,
  /** Header icon. Defaults from `intent` when omitted. */
  icon?: (typeof IconBase) | ReactNode,
  /** Notification intent. Defaults to {@link Intent.Default}. */
  intent?: Intent,
  /** Auto-dismiss delay in milliseconds. Defaults to `null`, which disables auto-dismiss. */
  timeout?: number | null,
  /** Optional notification heading. */
  title?: ReactNode,
}

interface Props extends INotification {
  id: string,
  onDismiss: () => void,
}

/** In-app notification: static {@link Notification.create} and mounted rows inside {@link OverlayProvider}. */
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

  get icon(): ReactNode {
    const intent = this.props.intent ?? Notification.Intent.Default
    if (this.props.icon) {
      return (this.props.icon?.constructor?.name === IconBase.name)
        // @ts-expect-error - TS doesn't like the SVGProps definitions
        ? createElement(this.props.icon, {})
        : this.props.icon as ReactNode
    }
    return <IntentIcon is={intent} />
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
        <Remove title="Dismiss" onClick={onDismiss} />
      </>
    )
  }
}
