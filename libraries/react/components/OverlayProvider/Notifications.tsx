import type { ReactNode } from 'react'
import { Component } from '../Component/Component'

interface Props {
  children?: ReactNode,
}

/**
 * Live region for notifications opened through the overlay host.
 */
export class Notifications extends Component<Props, HTMLElement> {
  static displayName = 'Notifications'

  get attributes() {
    return {
      ...super.attributes,
      'aria-label': 'Notifications',
      'aria-live': 'polite' as const,
    }
  }

  get tag() {
    return 'section' as const
  }
}
