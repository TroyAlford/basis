import * as React from 'react'
import { Intent as IntentEnum } from '../types/Intent'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { SquareCheck } from './SquareCheck'
import { Warning } from './Warning'

/** The filled warning glyph used for a dangerous intent. */
class IntentDanger extends Warning {
  static displayName = 'IntentDangerIcon'
  static get defaultProps() {
    return { ...super.defaultProps, filled: true }
  }
}

/** The filled check glyph used for a successful intent. */
class IntentSuccess extends SquareCheck {
  static displayName = 'IntentSuccessIcon'
  static get defaultProps() {
    return { ...super.defaultProps, filled: true }
  }
}

type Props = IconProps<{
  /** The intent whose icon to render */
  intent?: IntentEnum,
}>

/**
 * The icon for a dialog or notification intent, or nothing when the intent has
 * no dedicated glyph.
 */
export class Intent extends IconBase<Props> {
  static displayName = 'Intent'
  static Is = IntentEnum
  static get defaultProps() {
    return {
      ...super.defaultProps,
      intent: IntentEnum.Danger,
    }
  }

  static Danger = IntentDanger
  static Success = IntentSuccess

  // Override Render instead of renderContent, so we don't get nesting
  render = (): React.ReactNode => {
    const { intent, ...props } = this.props

    switch (intent) {
      case IntentEnum.Danger: return <IntentDanger {...props} />
      case IntentEnum.Success: return <IntentSuccess {...props} />
      default: return null
    }
  }
}
