import type { ReactNode } from 'react'
import { IconBase } from '@basis/react/icons/IconBase/IconBase'
import { match } from '@basis/utilities'
import { Intent as Enum } from '../types/Intent'
import { SquareCheck } from './SquareCheck'
import { Warning } from './Warning'

interface Props {
  is: Enum,
}

/**
 * Renders the default icon for a dialog or notification intent, or nothing when the intent has no
 * dedicated icon.
 */
export class Intent extends IconBase<Props> {
  static displayName = 'IntentIcon'
  static Is = Enum

  static Danger = <Warning filled title="Warning" />
  static Success = <SquareCheck filled title="Success" />

  override render = (): ReactNode => (
    match(this.props.is)
      .when(Enum.Danger).then(Intent.Danger)
      .when(Enum.Success).then(Intent.Success)
      .else(null)
  )
}
