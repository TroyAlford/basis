import type { ReactNode } from 'react'
import { Component } from '../Component/Component'

interface Props {
  children?: ReactNode,
}

/**
 * Live region for modal dialogs opened through the overlay host.
 */
export class OverlayDialogRegion extends Component<Props, HTMLElement> {
  static displayName = 'OverlayDialogRegion'

  get attributes() {
    return {
      ...super.attributes,
      'aria-live': 'assertive' as const,
    }
  }

  get tag() {
    return 'section' as const
  }
}
