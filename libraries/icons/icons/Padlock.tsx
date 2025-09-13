import * as React from 'react'
import type { IconProps } from '../IconBase/IconBase'
import { IconBase } from '../IconBase/IconBase'
import { PadlockLocked } from './PadlockLocked'
import { PadlockUnlocked } from './PadlockUnlocked'

enum LockState {
  Locked = 'Locked',
  Unlocked = 'Unlocked',
}

type Props = IconProps<{
  /** Whether the padlock is locked or unlocked */
  locked?: boolean,
}>

export class Padlock extends IconBase<Props> {
  static displayName = 'Padlock'
  static LockState = LockState
  static get defaultProps() {
    return {
      ...super.defaultProps,
      filled: false,
      locked: true,
    }
  }

  static Locked = PadlockLocked
  static Unlocked = PadlockUnlocked

  // Override Render instead of renderContent, so we don't get nesting
  render = (): React.ReactNode => {
    const { locked, ...props } = this.props

    if (locked) {
      return <PadlockLocked {...props} />
    }

    return <PadlockUnlocked {...props} />
  }
}
