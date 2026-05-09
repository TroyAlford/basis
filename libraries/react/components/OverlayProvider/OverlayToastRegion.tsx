import type { ReactNode } from 'react'
import { Component } from '../Component/Component'

interface Props {
  children?: ReactNode,
}

/**
 * Live region for toast notifications.
 */
export class OverlayToastRegion extends Component<Props, HTMLElement> {
  static displayName = 'OverlayToastRegion'

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
